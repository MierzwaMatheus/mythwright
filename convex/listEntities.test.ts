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

describe("entities.listEntities", () => {
  it("retorna todas as entidades da campanha sem filtro", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|le001", "le001@test.com");

    await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "npc",
      name: "Guarda Real",
      visibility: "known",
      description: "Um guarda.",
    });

    await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "location",
      name: "Torre Secreta",
      visibility: "hidden",
      description: "Uma torre.",
    });

    const entities = await identity.query(api.entities.listEntities, { campaignId });
    expect(entities).toHaveLength(2);
  });

  it("filtra apenas entidades known quando visibility='known'", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|le002", "le002@test.com");

    await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "npc",
      name: "NPC Visível",
      visibility: "known",
      description: "Visível.",
    });

    await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "npc",
      name: "NPC Oculto",
      visibility: "hidden",
      description: "Oculto.",
    });

    const entities = await identity.query(api.entities.listEntities, {
      campaignId,
      visibility: "known",
    });

    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe("NPC Visível");
  });

  it("filtra apenas entidades hidden quando visibility='hidden'", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|le003", "le003@test.com");

    await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "npc",
      name: "NPC Visível",
      visibility: "known",
      description: "Visível.",
    });

    await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "npc",
      name: "NPC Oculto",
      visibility: "hidden",
      description: "Oculto.",
    });

    const entities = await identity.query(api.entities.listEntities, {
      campaignId,
      visibility: "hidden",
    });

    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe("NPC Oculto");
  });

  it("filtra por type quando type fornecido", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|le004", "le004@test.com");

    await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "npc",
      name: "Um NPC",
      visibility: "known",
      description: "NPC.",
    });

    await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "location",
      name: "Uma Localização",
      visibility: "known",
      description: "Local.",
    });

    const entities = await identity.query(api.entities.listEntities, {
      campaignId,
      type: "npc",
    });

    expect(entities).toHaveLength(1);
    expect(entities[0].type).toBe("npc");
  });

  it("retorna lista vazia quando não há entidades", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|le005", "le005@test.com");

    const entities = await identity.query(api.entities.listEntities, { campaignId });
    expect(entities).toEqual([]);
  });

  it("não retorna entidades de outra campanha", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|le006", "le006@test.com");
    const { campaignId: otherCampaignId } = await setupUserAndCampaign(t, "token|le006b", "le006b@test.com");

    await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "npc",
      name: "NPC da campanha A",
      visibility: "known",
      description: "NPC.",
    });

    const entities = await identity.query(api.entities.listEntities, {
      campaignId: otherCampaignId,
    });

    expect(entities).toHaveLength(0);
  });

  it("sem autenticacao — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|le007", "le007@test.com");

    await expect(
      t.query(api.entities.listEntities, { campaignId }),
    ).rejects.toThrow(ConvexError);
  });
});
