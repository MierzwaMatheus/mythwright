/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";
import { ConvexError } from "convex/values";

const modules = import.meta.glob("./**/*.ts");

async function setupUserCampaignAndScene(
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
  const sceneId = await identity.mutation(api.scenes.createScene, {
    campaignId: campaignId as Id<"campaigns">,
    title: "Cena",
  });
  await identity.mutation(api.scenes.updateSceneStatus, {
    sceneId: sceneId as Id<"scenes">,
    status: "active",
  });
  const characterId = await identity.mutation(api.characters.createCharacter, {
    campaignId: campaignId as Id<"campaigns">,
    name: "Herói",
    aspects: ["Corajoso"],
    skills: {},
    stunts: [],
    stress: { physical: [false, false], mental: [false, false] },
  });
  const aspectId = await identity.mutation(api.sceneAspects.addSceneAspect, {
    sceneId: sceneId as Id<"scenes">,
    text: "Em chamas",
    freeInvokes: 1,
  });
  return {
    identity,
    campaignId: campaignId as Id<"campaigns">,
    sceneId: sceneId as Id<"scenes">,
    characterId: characterId as Id<"characters">,
    aspectId: aspectId as Id<"sceneAspects">,
  };
}

describe("compels.beginCompel", () => {
  it("cria compel pendente e retorna compelId", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId, aspectId, characterId } =
      await setupUserCampaignAndScene(t, "token|cp001", "cp001@test.com");

    const compelId = await identity.mutation(api.compels.beginCompel, {
      campaignId,
      aspectId,
      characterId,
      complication: "Você deve parar de lutar e fugir",
    });

    expect(typeof compelId).toBe("string");
    expect(compelId.length).toBeGreaterThan(0);
  });

  it("documento persiste com todos os campos corretos", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId, aspectId, characterId } =
      await setupUserCampaignAndScene(t, "token|cp002", "cp002@test.com");

    const compelId = await identity.mutation(api.compels.beginCompel, {
      campaignId,
      aspectId,
      characterId,
      complication: "Uma armadilha se fecha ao seu redor",
    });

    await t.run(async (ctx) => {
      const compel = await ctx.db.get(compelId as Id<"compels">);
      expect(compel).not.toBeNull();
      expect(compel!.campaignId).toBe(campaignId);
      expect(compel!.aspectId).toBe(aspectId);
      expect(compel!.characterId).toBe(characterId);
      expect(compel!.complication).toBe("Uma armadilha se fecha ao seu redor");
      expect(compel!.status).toBe("pending");
      expect(typeof compel!.createdAt).toBe("number");
    });
  });

  it("sem autenticacao — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, aspectId, characterId } =
      await setupUserCampaignAndScene(t, "token|cp003", "cp003@test.com");

    await expect(
      t.mutation(api.compels.beginCompel, {
        campaignId,
        aspectId,
        characterId,
        complication: "Complicação não autenticada",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("campanha de outro usuario — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, aspectId, characterId } =
      await setupUserCampaignAndScene(t, "token|cp004", "cp004@test.com");

    const other = t.withIdentity({ tokenIdentifier: "token|cp004b", email: "cp004b@test.com" });
    await other.mutation(api.users.upsertFromAuth, { displayName: "Outro GM" });

    await expect(
      other.mutation(api.compels.beginCompel, {
        campaignId,
        aspectId,
        characterId,
        complication: "Complicação não autorizada",
      }),
    ).rejects.toThrow(ConvexError);
  });
});
