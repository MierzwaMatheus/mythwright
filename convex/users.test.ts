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
});
