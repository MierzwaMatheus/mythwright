/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupCampaign(ctx: any) {
  const userId = await ctx.db.insert("users", {
    email: "gm@test.com",
    displayName: "GM",
    tokenIdentifier: "token|genchar001",
  });
  const campaignId = await ctx.db.insert("campaigns", {
    userId,
    name: "A Lâmina de Ferro",
    premise: "Um caçador de recompensas em uma cidade portuária corrupta.",
    tone: "noir",
    expectedDuration: "one-shot",
    status: "active",
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  });
  return { userId, campaignId };
}

const mockCharacterResponse = {
  name: "Marcos Veil",
  high_concept: "Detetive Cético em Cidade Embruxada",
  trouble: "Devo Favores ao Crime Organizado",
  other_aspects: [
    "Veterano da Guerra do Norte",
    "O Caso que Me Quebrou",
    "Aliado Improvável no Porto",
  ],
  skills: {
    Investigar: 4,
    Empatia: 3,
    Notar: 3,
    Comunicar: 2,
    Vontade: 2,
    Atletismo: 2,
    Lutar: 1,
    Contatos: 1,
    Saber: 1,
    Sobreviver: 1,
  },
  stunts: [
    {
      name: "Olho Treinado",
      description: "+2 em Notar para detectar mentiras visuais quando o alvo está nervoso.",
    },
    {
      name: "Contatos Militares",
      description: "Pode usar Contatos em vez de Recursos para obter equipamento militar.",
    },
    {
      name: "Interrogatório Duro",
      description: "+2 em Provocar para criar vantagens durante interrogatórios.",
    },
  ],
  fate_points: 3,
  stress: {
    physical: [false, false, false],
    mental: [false, false, false],
  },
  background_summary:
    "Marcos serviu no exército por dez anos antes de tornar-se detetive particular.",
};

describe("generateCharacter", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("persiste personagem no banco com campos obrigatórios de ficha FATE", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await t.run(setupCampaign);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockCharacterResponse) } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    const characterId = await t.action(internal.generateCharacter.generateCharacter, {
      campaignId,
      characterPremise: "Um detetive desiludido com passado militar.",
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character).not.toBeNull();
      expect(character!.name).toBe("Marcos Veil");
      expect(character!.campaignId).toBe(campaignId);
    });
  });

  it("persiste 5 aspectos no campo aspects (high_concept + trouble + 3 others)", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await t.run(setupCampaign);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockCharacterResponse) } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    const characterId = await t.action(internal.generateCharacter.generateCharacter, {
      campaignId,
      characterPremise: "Um detetive desiludido com passado militar.",
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.aspects).toHaveLength(5);
      expect(character!.aspects[0]).toBe("Detetive Cético em Cidade Embruxada");
      expect(character!.aspects[1]).toBe("Devo Favores ao Crime Organizado");
    });
  });

  it("persiste pirâmide de perícias no campo skills", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await t.run(setupCampaign);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockCharacterResponse) } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    const characterId = await t.action(internal.generateCharacter.generateCharacter, {
      campaignId,
      characterPremise: "Um detetive desiludido com passado militar.",
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(Object.keys(character!.skills).length).toBe(10);
      expect(character!.skills["Investigar"]).toBe(4);
    });
  });

  it("persiste façanhas como array de strings no campo stunts", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await t.run(setupCampaign);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockCharacterResponse) } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    const characterId = await t.action(internal.generateCharacter.generateCharacter, {
      campaignId,
      characterPremise: "Um detetive desiludido com passado militar.",
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.stunts).toHaveLength(3);
      expect(typeof character!.stunts[0]).toBe("string");
      expect(character!.stunts[0]).toContain("Olho Treinado");
    });
  });

  it("persiste fatePoints e stress tracks corretos", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await t.run(setupCampaign);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockCharacterResponse) } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    const characterId = await t.action(internal.generateCharacter.generateCharacter, {
      campaignId,
      characterPremise: "Um detetive desiludido com passado militar.",
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.fatePoints).toBe(3);
      expect(character!.stress.physical).toEqual([false, false, false]);
      expect(character!.stress.mental).toEqual([false, false, false]);
    });
  });

  it("lança erro quando LLM retorna ficha inválida", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await t.run(setupCampaign);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "not valid json" } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await expect(
      t.action(internal.generateCharacter.generateCharacter, {
        campaignId,
        characterPremise: "Um detetive.",
      }),
    ).rejects.toThrow();
  });

  it("lança erro quando LLM retorna ficha com pirâmide incorreta", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await t.run(setupCampaign);

    const invalidChar = {
      ...mockCharacterResponse,
      skills: { Investigar: 4 }, // only 1 skill instead of 10
    };

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(invalidChar) } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await expect(
      t.action(internal.generateCharacter.generateCharacter, {
        campaignId,
        characterPremise: "Um detetive.",
      }),
    ).rejects.toThrow();
  });
});
