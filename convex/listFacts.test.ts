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
  }) as Id<"campaigns">;
  return { identity, campaignId };
}

describe("facts.listFacts", () => {
  it("retorna todos os fatos da campanha sem filtro", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|lf001", "lf001@test.com");

    await identity.mutation(api.facts.createFact, {
      campaignId,
      content: "O rei é traidor.",
      visibility: "hidden",
    });

    await identity.mutation(api.facts.createFact, {
      campaignId,
      content: "A rainha é aliada.",
      visibility: "known",
    });

    const facts = await identity.query(api.facts.listFacts, { campaignId });
    expect(facts).toHaveLength(2);
  });

  it("filtra apenas fatos hidden quando visibility='hidden'", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|lf002", "lf002@test.com");

    await identity.mutation(api.facts.createFact, {
      campaignId,
      content: "Fato oculto.",
      visibility: "hidden",
    });

    await identity.mutation(api.facts.createFact, {
      campaignId,
      content: "Fato conhecido.",
      visibility: "known",
    });

    const facts = await identity.query(api.facts.listFacts, {
      campaignId,
      visibility: "hidden",
    });

    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe("Fato oculto.");
  });

  it("filtra apenas fatos rumored quando visibility='rumored'", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|lf003", "lf003@test.com");

    await identity.mutation(api.facts.createFact, {
      campaignId,
      content: "Fato rumor.",
      visibility: "rumored",
    });

    await identity.mutation(api.facts.createFact, {
      campaignId,
      content: "Fato conhecido.",
      visibility: "known",
    });

    const facts = await identity.query(api.facts.listFacts, {
      campaignId,
      visibility: "rumored",
    });

    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe("Fato rumor.");
  });

  it("retorna lista vazia quando não há fatos", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|lf004", "lf004@test.com");

    const facts = await identity.query(api.facts.listFacts, { campaignId });
    expect(facts).toEqual([]);
  });

  it("não retorna fatos de outra campanha", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|lf005", "lf005@test.com");
    const { campaignId: otherCampaignId } = await setupUserAndCampaign(t, "token|lf005b", "lf005b@test.com");

    await identity.mutation(api.facts.createFact, {
      campaignId,
      content: "Fato da campanha A.",
      visibility: "known",
    });

    const facts = await identity.query(api.facts.listFacts, { campaignId: otherCampaignId });
    expect(facts).toHaveLength(0);
  });

  it("sem autenticacao — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|lf006", "lf006@test.com");

    await expect(
      t.query(api.facts.listFacts, { campaignId }),
    ).rejects.toThrow(ConvexError);
  });

  it("retorna relatedEntityIds quando presentes", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|lf007", "lf007@test.com");

    const entityId = await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "npc",
      name: "NPC Relacionado",
      visibility: "known",
      description: "Um NPC.",
    }) as Id<"entities">;

    await identity.mutation(api.facts.createFact, {
      campaignId,
      content: "Fato com entidade.",
      visibility: "known",
      relatedEntityIds: [entityId],
    });

    const facts = await identity.query(api.facts.listFacts, { campaignId });
    expect(facts).toHaveLength(1);
    expect(facts[0].relatedEntityIds).toEqual([entityId]);
  });
});
