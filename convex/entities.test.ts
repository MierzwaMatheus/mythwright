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

describe("entities.createEntity", () => {
  it("persiste todos os campos e retorna entityId", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ent001", "ent001@test.com");

    const entityId = await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "npc",
      name: "Erevan, o Mercador",
      visibility: "known",
      description: "Um mercador misterioso que sempre aparece na hora certa.",
    });

    expect(typeof entityId).toBe("string");
    expect(entityId.length).toBeGreaterThan(0);
  });

  it("documento persiste corretamente — campos verificados via ctx.db.get", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ent002", "ent002@test.com");

    const entityId = await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "location",
      name: "Torre dos Ventos",
      visibility: "hidden",
      description: "Uma torre abandonada no alto das montanhas.",
    });

    await t.run(async (ctx) => {
      const entity = await ctx.db.get(entityId as Id<"entities">);
      expect(entity).not.toBeNull();
      expect(entity!.campaignId).toBe(campaignId);
      expect(entity!.type).toBe("location");
      expect(entity!.name).toBe("Torre dos Ventos");
      expect(entity!.visibility).toBe("hidden");
      expect(entity!.description).toBe("Uma torre abandonada no alto das montanhas.");
    });
  });

  it("sem autenticacao — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|ent003", "ent003@test.com");

    await expect(
      t.mutation(api.entities.createEntity, {
        campaignId,
        type: "faction",
        name: "Guilda dos Ladrões",
        visibility: "known",
        description: "Uma organização criminosa poderosa.",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("campanha de outro usuario — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|ent004", "ent004@test.com");

    const other = t.withIdentity({ tokenIdentifier: "token|ent004b", email: "ent004b@test.com" });
    await other.mutation(api.users.upsertFromAuth, { displayName: "Outro GM" });

    await expect(
      other.mutation(api.entities.createEntity, {
        campaignId,
        type: "item",
        name: "Espada Sagrada",
        visibility: "known",
        description: "Uma espada lendária forjada pelos deuses.",
      }),
    ).rejects.toThrow(ConvexError);
  });
});
