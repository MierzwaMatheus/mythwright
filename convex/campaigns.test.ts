/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";
import { ConvexError } from "convex/values";

const modules = import.meta.glob("./**/*.ts");

describe("campaigns.createCampaign", () => {
  const campaignInput = {
    name: "A Maldição de Ironveil",
    premise: "Heróis investigam desaparecimentos numa cidade mineira.",
    tone: "dark fantasy",
    expectedDuration: "medium" as const,
  };

  it("retorna um ID válido ao criar campanha", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|c001", email: "gm@mythwright.com" });

    await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });
    const id = await identity.mutation(api.campaigns.createCampaign, campaignInput);

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("persiste status 'setup' automaticamente", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|c002", email: "gm2@mythwright.com" });

    await identity.mutation(api.users.upsertFromAuth, { displayName: "GM2" });
    const id = await identity.mutation(api.campaigns.createCampaign, campaignInput);

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(id as Id<"campaigns">);
      expect(campaign).not.toBeNull();
      expect(campaign!.status).toBe("setup");
    });
  });

  it("persiste userId do usuário autenticado (não recebido como argumento)", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|c003", email: "gm3@mythwright.com" });

    await identity.mutation(api.users.upsertFromAuth, { displayName: "GM3" });
    const id = await identity.mutation(api.campaigns.createCampaign, campaignInput);

    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", "token|c003"))
        .unique();
      const campaign = await ctx.db.get(id as Id<"campaigns">);
      expect(campaign).not.toBeNull();
      expect(campaign!.userId).toBe(user!._id);
    });
  });

  it("lança erro quando não autenticado", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.campaigns.createCampaign, campaignInput)
    ).rejects.toThrow();
  });

  it("persiste createdAt e lastActivityAt como números (timestamps)", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|c005", email: "gm5@mythwright.com" });

    await identity.mutation(api.users.upsertFromAuth, { displayName: "GM5" });
    const id = await identity.mutation(api.campaigns.createCampaign, campaignInput);

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(id as Id<"campaigns">);
      expect(campaign).not.toBeNull();
      expect(typeof campaign!.createdAt).toBe("number");
      expect(typeof campaign!.lastActivityAt).toBe("number");
      expect(campaign!.createdAt).toBeGreaterThan(0);
      expect(campaign!.lastActivityAt).toBeGreaterThan(0);
    });
  });
});

describe("campaigns.listCampaigns", () => {
  const campaignInput = {
    name: "A Maldição de Ironveil",
    premise: "Heróis investigam desaparecimentos numa cidade mineira.",
    tone: "dark fantasy",
    expectedDuration: "medium" as const,
  };

  it("retorna campanhas do usuário autenticado", async () => {
    const t = convexTest(schema, modules);
    const identityA = t.withIdentity({ tokenIdentifier: "userA|list001", email: "a@test.com" });

    await identityA.mutation(api.users.upsertFromAuth, { displayName: "User A" });
    await identityA.mutation(api.campaigns.createCampaign, { ...campaignInput, name: "Campanha 1" });
    await identityA.mutation(api.campaigns.createCampaign, { ...campaignInput, name: "Campanha 2" });

    const result = await identityA.query(api.campaigns.listCampaigns, {});

    expect(result).toHaveLength(2);
  });

  it("ordena campanhas por lastActivityAt desc", async () => {
    const t = convexTest(schema, modules);
    const identityA = t.withIdentity({ tokenIdentifier: "userA|list002", email: "a2@test.com" });

    await identityA.mutation(api.users.upsertFromAuth, { displayName: "User A2" });
    const id1 = await identityA.mutation(api.campaigns.createCampaign, { ...campaignInput, name: "Antiga" });
    const id2 = await identityA.mutation(api.campaigns.createCampaign, { ...campaignInput, name: "Nova" });

    await t.run(async (ctx) => {
      await ctx.db.patch(id1 as Id<"campaigns">, { lastActivityAt: 1000 });
      await ctx.db.patch(id2 as Id<"campaigns">, { lastActivityAt: 2000 });
    });

    const result = await identityA.query(api.campaigns.listCampaigns, {});

    expect(result[0].name).toBe("Nova");
    expect(result[1].name).toBe("Antiga");
  });

  it("nunca retorna campanhas de outro usuário", async () => {
    const t = convexTest(schema, modules);
    const identityA = t.withIdentity({ tokenIdentifier: "userA|list003", email: "a3@test.com" });
    const identityB = t.withIdentity({ tokenIdentifier: "userB|list003", email: "b3@test.com" });

    await identityA.mutation(api.users.upsertFromAuth, { displayName: "User A3" });
    await identityB.mutation(api.users.upsertFromAuth, { displayName: "User B3" });

    await identityA.mutation(api.campaigns.createCampaign, { ...campaignInput, name: "Campanha de A" });
    await identityB.mutation(api.campaigns.createCampaign, { ...campaignInput, name: "Campanha de B" });

    const resultA = await identityA.query(api.campaigns.listCampaigns, {});

    expect(resultA).toHaveLength(1);
    expect(resultA[0].name).toBe("Campanha de A");
  });

  it("retorna lista vazia quando não há campanhas", async () => {
    const t = convexTest(schema, modules);
    const identityA = t.withIdentity({ tokenIdentifier: "userA|list004", email: "a4@test.com" });

    await identityA.mutation(api.users.upsertFromAuth, { displayName: "User A4" });

    const result = await identityA.query(api.campaigns.listCampaigns, {});

    expect(result).toEqual([]);
  });

  it("lança erro quando não autenticado", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.query(api.campaigns.listCampaigns, {})
    ).rejects.toThrow();
  });
});
