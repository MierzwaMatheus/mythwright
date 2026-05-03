/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";
import { ConvexError } from "convex/values";

const modules = import.meta.glob("./**/*.ts");

const defaultCharacterInput = {
  name: "Aric Stormhand",
  aspects: ["Mago errante", "Dívida com o passado"],
  skills: { Fight: 3, Lore: 4 },
  stunts: ["Arcane Armor"],
  stress: {
    physical: [false, false],
    mental: [false, false, false],
  },
};

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

describe("characters.createCharacter", () => {
  it("happy path — cria personagem com todos os campos e retorna _id", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ch001", "ch001@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
      fatePoints: 5,
    });

    expect(typeof characterId).toBe("string");
    expect(characterId.length).toBeGreaterThan(0);

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId as Id<"characters">);
      expect(character).not.toBeNull();
      expect(character!.name).toBe("Aric Stormhand");
      expect(character!.aspects).toEqual(["Mago errante", "Dívida com o passado"]);
      expect(character!.skills).toEqual({ Fight: 3, Lore: 4 });
      expect(character!.stunts).toEqual(["Arcane Armor"]);
      expect(character!.fatePoints).toBe(5);
      expect(character!.stress).toEqual({
        physical: [false, false],
        mental: [false, false, false],
      });
      expect(character!.campaignId).toBe(campaignId);
    });
  });

  it("fatePoints padrao — omitir resulta em 3", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ch002", "ch002@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId as Id<"characters">);
      expect(character!.fatePoints).toBe(3);
    });
  });

  it("consequences sempre comeca vazio", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ch003", "ch003@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId as Id<"characters">);
      expect(character!.consequences).toEqual([]);
    });
  });

  it("maximo 5 aspects — 6 aspects rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ch004", "ch004@test.com");

    await expect(
      identity.mutation(api.characters.createCharacter, {
        ...defaultCharacterInput,
        campaignId,
        aspects: ["A1", "A2", "A3", "A4", "A5", "A6"],
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("sem autenticacao — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|ch005", "ch005@test.com");

    await expect(
      t.mutation(api.characters.createCharacter, {
        ...defaultCharacterInput,
        campaignId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("campanha inexistente — rejeita com erro", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|ch006", email: "ch006@test.com" });
    await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });

    // Cria e deleta uma campanha para obter um ID válido porém inexistente
    const validButDeletedId = await identity.mutation(api.campaigns.createCampaign, {
      name: "Campanha deletada",
      premise: "Sera deletada.",
      tone: "dark",
      expectedDuration: "one-shot",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete(validButDeletedId as Id<"campaigns">);
    });

    await expect(
      identity.mutation(api.characters.createCharacter, {
        ...defaultCharacterInput,
        campaignId: validButDeletedId as Id<"campaigns">,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("campanha de outro usuario — rejeita com ConvexError Unauthorized", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|ch007", "ch007@test.com");

    const other = t.withIdentity({ tokenIdentifier: "token|ch007b", email: "ch007b@test.com" });
    await other.mutation(api.users.upsertFromAuth, { displayName: "Outro GM" });

    await expect(
      other.mutation(api.characters.createCharacter, {
        ...defaultCharacterInput,
        campaignId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});
