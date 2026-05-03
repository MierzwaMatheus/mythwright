/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("users.upsertFromAuth", () => {
  it("persists email and displayName for a new user", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity({ tokenIdentifier: "token|001", email: "hero@mythwright.com" }).mutation(
      api.users.upsertFromAuth,
      { displayName: "Hero" }
    );
    const users = await t.query(api.users.list);
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("hero@mythwright.com");
    expect(users[0].displayName).toBe("Hero");
  });

  it("persists avatar when provided", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity({ tokenIdentifier: "token|002", email: "mage@mythwright.com" }).mutation(
      api.users.upsertFromAuth,
      { displayName: "Mage", avatar: "https://cdn.example.com/mage.png" }
    );
    const users = await t.query(api.users.list);
    expect(users[0].avatar).toBe("https://cdn.example.com/mage.png");
  });

  it("avatar is undefined (not null) when not provided", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity({ tokenIdentifier: "token|003", email: "rogue@mythwright.com" }).mutation(
      api.users.upsertFromAuth,
      { displayName: "Rogue" }
    );
    const users = await t.query(api.users.list);
    expect(users[0].avatar).toBeUndefined();
    expect(users[0].avatar).not.toBeNull();
  });

  it("upserts (updates) an existing user with the same tokenIdentifier", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|004", email: "bard@mythwright.com" });

    await identity.mutation(api.users.upsertFromAuth, { displayName: "Bard v1" });
    await identity.mutation(api.users.upsertFromAuth, {
      displayName: "Bard v2",
      avatar: "https://cdn.example.com/bard.png",
    });

    const users = await t.query(api.users.list);
    expect(users).toHaveLength(1);
    expect(users[0].displayName).toBe("Bard v2");
    expect(users[0].avatar).toBe("https://cdn.example.com/bard.png");
  });

  it("does not expose key or encrypted fields in returned objects", async () => {
    const t = convexTest(schema, modules);
    const result = await t
      .withIdentity({ tokenIdentifier: "token|005", email: "paladin@mythwright.com" })
      .mutation(api.users.upsertFromAuth, { displayName: "Paladin" });

    if (result !== null && result !== undefined) {
      const keys = Object.keys(result as object);
      const sensitiveKeys = keys.filter(
        (k) => k.toLowerCase().includes("key") || k.toLowerCase().includes("encrypted")
      );
      expect(sensitiveKeys).toHaveLength(0);
    } else {
      expect(result == null).toBe(true);
    }
  });
});

describe("users.saveOpenRouterKey", () => {
  it("stores value in DB different from plaintext (encrypted at rest)", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|101", email: "wizard@mythwright.com" });

    await identity.mutation(api.users.upsertFromAuth, { displayName: "Wizard" });
    await identity.mutation(api.users.saveOpenRouterKey, { key: "sk-or-plaintext-abc123" });

    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", "token|101"))
        .unique();
      expect(user).not.toBeNull();
      expect(user!.encryptedOpenRouterKey).toBeDefined();
      expect(user!.encryptedOpenRouterKey).not.toBe("sk-or-plaintext-abc123");
    });
  });

  it("throws when called without authentication", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.users.saveOpenRouterKey, { key: "sk-or-plaintext-abc123" })
    ).rejects.toThrow();
  });

  it("overwrites previous key instead of duplicating", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|102", email: "druid@mythwright.com" });

    await identity.mutation(api.users.upsertFromAuth, { displayName: "Druid" });
    await identity.mutation(api.users.saveOpenRouterKey, { key: "sk-or-first-key" });
    await identity.mutation(api.users.saveOpenRouterKey, { key: "sk-or-second-key" });

    await t.run(async (ctx) => {
      const allUsers = await ctx.db.query("users").collect();
      const druidUsers = allUsers.filter((u) => u.tokenIdentifier === "token|102");
      expect(druidUsers).toHaveLength(1);
      expect(druidUsers[0].encryptedOpenRouterKey).toBeDefined();
    });
  });
});

describe("users.getMyOpenRouterKey", () => {
  it("returns decrypted plaintext for the authenticated owner", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|201", email: "ranger@mythwright.com" });

    await identity.mutation(api.users.upsertFromAuth, { displayName: "Ranger" });
    await identity.mutation(api.users.saveOpenRouterKey, { key: "sk-or-secret-ranger" });

    const result = await identity.query(api.users.getMyOpenRouterKey, {});
    expect(result).toBe("sk-or-secret-ranger");
  });

  it("returns null when no key has been saved", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|202", email: "monk@mythwright.com" });

    await identity.mutation(api.users.upsertFromAuth, { displayName: "Monk" });

    const result = await identity.query(api.users.getMyOpenRouterKey, {});
    expect(result).toBeNull();
  });

  it("returns only the caller's key, not another user's key", async () => {
    const t = convexTest(schema, modules);

    const userA = t.withIdentity({ tokenIdentifier: "token|203", email: "fighter@mythwright.com" });
    const userB = t.withIdentity({ tokenIdentifier: "token|204", email: "sorcerer@mythwright.com" });

    await userA.mutation(api.users.upsertFromAuth, { displayName: "Fighter" });
    await userA.mutation(api.users.saveOpenRouterKey, { key: "sk-or-fighters-secret" });

    await userB.mutation(api.users.upsertFromAuth, { displayName: "Sorcerer" });

    const resultB = await userB.query(api.users.getMyOpenRouterKey, {});
    expect(resultB).toBeNull();
    expect(resultB).not.toBe("sk-or-fighters-secret");
  });
});

describe("users.list anti-leak", () => {
  it("does not include key or encrypted fields in returned user objects", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|301", email: "cleric@mythwright.com" });

    await identity.mutation(api.users.upsertFromAuth, { displayName: "Cleric" });
    await identity.mutation(api.users.saveOpenRouterKey, { key: "sk-or-cleric-secret" });

    const users = await t.query(api.users.list);
    expect(users).toHaveLength(1);

    for (const user of users) {
      const keys = Object.keys(user);
      const sensitiveKeys = keys.filter(
        (k) => k.toLowerCase().includes("key") || k.toLowerCase().includes("encrypted")
      );
      expect(sensitiveKeys).toHaveLength(0);
    }
  });
});
