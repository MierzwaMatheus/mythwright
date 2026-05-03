/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

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
      const campaign = await ctx.db.get(id as any);
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
      const campaign = await ctx.db.get(id as any);
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
      const campaign = await ctx.db.get(id as any);
      expect(campaign).not.toBeNull();
      expect(typeof campaign!.createdAt).toBe("number");
      expect(typeof campaign!.lastActivityAt).toBe("number");
      expect(campaign!.createdAt).toBeGreaterThan(0);
      expect(campaign!.lastActivityAt).toBeGreaterThan(0);
    });
  });
});
