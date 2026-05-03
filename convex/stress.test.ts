/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";
import { ConvexError } from "convex/values";

const modules = import.meta.glob("./**/*.ts");

async function setupCharacterWithConsequences(
  t: ReturnType<typeof convexTest>,
  consequences: Array<{ severity: "mild" | "moderate" | "severe"; description: string }>,
) {
  const identity = t.withIdentity({ tokenIdentifier: "token|cons001", email: "cons001@test.com" });
  await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });
  const campaignId = await identity.mutation(api.campaigns.createCampaign, {
    name: "Test",
    premise: "Test",
    tone: "dark",
    expectedDuration: "medium",
  });
  const characterId = await identity.mutation(api.characters.createCharacter, {
    campaignId,
    name: "Hero",
    aspects: [],
    skills: {},
    stunts: [],
    stress: { physical: [false, false, false], mental: [false, false] },
  });

  if (consequences.length > 0) {
    await t.run(async (ctx) => {
      await ctx.db.patch(characterId as Id<"characters">, { consequences });
    });
  }

  return { identity, campaignId: campaignId as Id<"campaigns">, characterId: characterId as Id<"characters"> };
}

async function setupCharacterWithStress(
  t: ReturnType<typeof convexTest>,
  track: "physical" | "mental",
  stressArray: boolean[],
) {
  const identity = t.withIdentity({ tokenIdentifier: "token|stress001", email: "stress001@test.com" });
  await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });
  const campaignId = await identity.mutation(api.campaigns.createCampaign, {
    name: "Test",
    premise: "Test",
    tone: "dark",
    expectedDuration: "medium",
  });
  const stress =
    track === "physical"
      ? { physical: stressArray, mental: [false, false] }
      : { physical: [false, false, false], mental: stressArray };

  const characterId = await identity.mutation(api.characters.createCharacter, {
    campaignId,
    name: "Hero",
    aspects: [],
    skills: {},
    stunts: [],
    stress,
  });

  return { identity, campaignId: campaignId as Id<"campaigns">, characterId: characterId as Id<"characters"> };
}

describe("stress.applyStress", () => {
  it("caixa exata disponível — marca índice amount-1 e retorna needsConsequence: false", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupCharacterWithStress(t, "physical", [false, false, false]);

    const result = await identity.mutation(api.stress.applyStress, {
      characterId,
      track: "physical",
      amount: 2,
    });

    expect(result).toEqual({ needsConsequence: false });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.stress.physical[0]).toBe(false); // caixa 1 intacta
      expect(character!.stress.physical[1]).toBe(true);  // caixa 2 marcada
      expect(character!.stress.physical[2]).toBe(false); // caixa 3 intacta
    });
  });

  it("caixa exata marcada — marca menor caixa disponível maior e retorna needsConsequence: false", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupCharacterWithStress(t, "physical", [false, true, false]);

    const result = await identity.mutation(api.stress.applyStress, {
      characterId,
      track: "physical",
      amount: 2,
    });

    expect(result).toEqual({ needsConsequence: false });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.stress.physical[0]).toBe(false); // caixa 1 intacta
      expect(character!.stress.physical[1]).toBe(true);  // caixa 2 já estava marcada
      expect(character!.stress.physical[2]).toBe(true);  // caixa 3 marcada como fallback
    });
  });

  it("nenhuma caixa disponível — retorna needsConsequence: true com overflow", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupCharacterWithStress(t, "physical", [true, true, true]);

    const result = await identity.mutation(api.stress.applyStress, {
      characterId,
      track: "physical",
      amount: 1,
    });

    expect(result).toEqual({ needsConsequence: true, overflow: 1 });
  });

  it("track mental — caixa exata disponível — marca e retorna needsConsequence: false", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupCharacterWithStress(t, "mental", [false, false]);

    const result = await identity.mutation(api.stress.applyStress, {
      characterId,
      track: "mental",
      amount: 1,
    });

    expect(result).toEqual({ needsConsequence: false });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.stress.mental[0]).toBe(true);  // caixa 1 marcada
      expect(character!.stress.mental[1]).toBe(false); // caixa 2 intacta
    });
  });

  it("sem autenticação — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { characterId } = await setupCharacterWithStress(t, "physical", [false, false, false]);

    await expect(
      t.mutation(api.stress.applyStress, {
        characterId,
        track: "physical",
        amount: 1,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("personagem de outra campanha — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { characterId } = await setupCharacterWithStress(t, "physical", [false, false, false]);

    const other = t.withIdentity({ tokenIdentifier: "token|stress002", email: "stress002@test.com" });
    await other.mutation(api.users.upsertFromAuth, { displayName: "Outro GM" });

    await expect(
      other.mutation(api.stress.applyStress, {
        characterId,
        track: "physical",
        amount: 1,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("stress.applyConsequence", () => {
  it("slot mild vazio — persiste e retorna absorbed: 2", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupCharacterWithConsequences(t, []);

    const result = await identity.mutation(api.stress.applyConsequence, {
      characterId,
      severity: "mild",
      description: "Tornozelinho torcido",
    });

    expect(result).toEqual({ absorbed: 2 });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.consequences).toContainEqual({
        severity: "mild",
        description: "Tornozelinho torcido",
      });
    });
  });

  it("slot moderate vazio — retorna absorbed: 4", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupCharacterWithConsequences(t, []);

    const result = await identity.mutation(api.stress.applyConsequence, {
      characterId,
      severity: "moderate",
      description: "Braço quebrado",
    });

    expect(result).toEqual({ absorbed: 4 });
  });

  it("slot severe vazio — retorna absorbed: 6", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupCharacterWithConsequences(t, []);

    const result = await identity.mutation(api.stress.applyConsequence, {
      characterId,
      severity: "severe",
      description: "Ferimento gravíssimo",
    });

    expect(result).toEqual({ absorbed: 6 });
  });

  it("slot ocupado — lança ConvexError com mensagem descritiva", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupCharacterWithConsequences(t, [
      { severity: "mild", description: "Já existe" },
    ]);

    await expect(
      identity.mutation(api.stress.applyConsequence, {
        characterId,
        severity: "mild",
        description: "Segunda mild",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("múltiplas severities coexistem — mild e moderate ao mesmo tempo", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupCharacterWithConsequences(t, [
      { severity: "mild", description: "Mild existente" },
    ]);

    await identity.mutation(api.stress.applyConsequence, {
      characterId,
      severity: "moderate",
      description: "Moderate novo",
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.consequences).toHaveLength(2);
      expect(character!.consequences).toContainEqual({ severity: "mild", description: "Mild existente" });
      expect(character!.consequences).toContainEqual({ severity: "moderate", description: "Moderate novo" });
    });
  });
});
