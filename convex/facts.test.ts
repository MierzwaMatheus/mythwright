/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";
import { ConvexError } from "convex/values";

const modules = import.meta.glob("./**/*.ts");

async function setupUserAndCampaign(
  t: ReturnType<typeof convexTest>,
  tokenIdentifier: string,
  email: string,
) {
  const identity = t.withIdentity({ tokenIdentifier, email });
  await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });
  const campaignId = await identity.mutation(api.campaigns.createCampaign, {
    name: "Campanha de Teste",
    premise: "Uma aventura épica.",
    tone: "dark fantasy",
    expectedDuration: "medium",
  });
  return { identity, campaignId: campaignId as Id<"campaigns"> };
}

describe("facts.createFact", () => {
  it("persiste todos os campos e retorna factId", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|fact001", "fact001@test.com");

    const factId = await identity.mutation(api.facts.createFact, {
      campaignId,
      content: "O rei está morto, mas ninguém sabe ainda.",
      visibility: "hidden",
    });

    expect(typeof factId).toBe("string");
    expect(factId.length).toBeGreaterThan(0);
  });

  it("documento persiste corretamente — campos verificados via ctx.db.get", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|fact002", "fact002@test.com");

    const factId = await identity.mutation(api.facts.createFact, {
      campaignId,
      content: "Existe um traidor na guilda.",
      visibility: "rumored",
    });

    await t.run(async (ctx) => {
      const fact = await ctx.db.get(factId as Id<"facts">);
      expect(fact).not.toBeNull();
      expect(fact!.campaignId).toBe(campaignId);
      expect(fact!.content).toBe("Existe um traidor na guilda.");
      expect(fact!.visibility).toBe("rumored");
    });
  });

  it("relatedEntityIds ausente — campo undefined no documento", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|fact003", "fact003@test.com");

    const factId = await identity.mutation(api.facts.createFact, {
      campaignId,
      content: "Um fato sem entidades relacionadas.",
      visibility: "known",
    });

    await t.run(async (ctx) => {
      const fact = await ctx.db.get(factId as Id<"facts">);
      expect(fact!.relatedEntityIds).toBeUndefined();
    });
  });

  it("relatedEntityIds fornecido — persiste como array", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|fact004", "fact004@test.com");

    const entityId = await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "npc",
      name: "O Traidor",
      visibility: "hidden",
      description: "Um membro secreto da guilda.",
    });

    const factId = await identity.mutation(api.facts.createFact, {
      campaignId,
      content: "O traidor é membro da guilda há anos.",
      visibility: "hidden",
      relatedEntityIds: [entityId as Id<"entities">],
    });

    await t.run(async (ctx) => {
      const fact = await ctx.db.get(factId as Id<"facts">);
      expect(fact!.relatedEntityIds).toEqual([entityId]);
    });
  });

  it("sem autenticacao — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|fact005", "fact005@test.com");

    await expect(
      t.mutation(api.facts.createFact, {
        campaignId,
        content: "Fato sem auth.",
        visibility: "known",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("campanha de outro usuario — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|fact006", "fact006@test.com");

    const other = t.withIdentity({ tokenIdentifier: "token|fact006b", email: "fact006b@test.com" });
    await other.mutation(api.users.upsertFromAuth, { displayName: "Outro GM" });

    await expect(
      other.mutation(api.facts.createFact, {
        campaignId,
        content: "Fato de outro usuário.",
        visibility: "known",
      }),
    ).rejects.toThrow(ConvexError);
  });
});
