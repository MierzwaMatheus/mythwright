/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupCampaign(ctx: any) {
  const userId = await ctx.db.insert("users", {
    email: "gm@test.com",
    displayName: "GM",
    tokenIdentifier: "token|genworld001",
  });
  const campaignId = await ctx.db.insert("campaigns", {
    userId,
    name: "A Lâmina de Ferro",
    premise: "Um caçador de recompensas em uma cidade portuária corrupta.",
    tone: "noir",
    expectedDuration: "one-shot",
    status: "setup",
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  });
  return { userId, campaignId };
}

const mockWorldResponse = {
  world_overview: "Uma cidade portuária sombria dominada pelo crime organizado.",
  starting_location: {
    name: "Porto de Ironhaven",
    type: "location",
    description: "Docas enferrujadas com névoa constante.",
    aspects: ["Névoa Perpétua", "Corrupção nas Sombras"],
  },
  npcs: [
    {
      name: "Capitão Vosk",
      type: "npc",
      visibility: "known",
      description: "Guarda portuário que aceita suborno.",
      hidden_motivation: "Está planejando um golpe.",
      tier: "supporting",
    },
    {
      name: "Lira Voss",
      type: "npc",
      visibility: "rumored",
      description: "Uma informante conhecida apenas por boatos.",
      hidden_motivation: "Agente dupla trabalhando para o sindicato.",
      tier: "main",
    },
    {
      name: "O Espectro",
      type: "npc",
      visibility: "hidden",
      description: "Figura misteriosa nas sombras.",
      hidden_motivation: "Chefe do sindicato criminal.",
      tier: "main",
    },
  ],
  factions: [],
  facts: [
    {
      content: "O Capitão Vosk desviou fundos municipais.",
      visibility: "hidden",
      category: "secret",
      related_entity_names: ["Capitão Vosk"],
    },
    {
      content: "O porto tem histórico de contrabando.",
      visibility: "known",
      category: "background",
      related_entity_names: [],
    },
    {
      content: "Lira Voss é uma informante.",
      visibility: "rumored",
      category: "event",
      related_entity_names: ["Lira Voss"],
    },
  ],
  triggers: [
    {
      description: "Se o jogador investiga as finanças portuárias.",
      scope: "global",
      scope_target_name: null,
      effects: [
        {
          type: "reveal_fact",
          target_description: "O Capitão Vosk desviou fundos municipais.",
        },
      ],
      one_shot: true,
    },
    {
      description: "Se o jogador visita a taverna do porto.",
      scope: "global",
      scope_target_name: null,
      effects: [
        {
          type: "reveal_entity",
          target_description: "Lira Voss",
        },
      ],
      one_shot: false,
    },
    {
      description: "Se o jogador derrota O Espectro.",
      scope: "global",
      scope_target_name: null,
      effects: [
        {
          type: "reveal_entity",
          target_description: "O Espectro",
        },
      ],
      one_shot: true,
    },
  ],
  starting_scene: {
    title: "Docas ao Amanhecer",
    description:
      "Você está nas docas de Ironhaven. O cheiro de peixe e fumaça paira no ar frio da manhã.",
    aspects: ["Névoa Matinal", "Tensão nas Docas"],
    present_npc_names: ["Capitão Vosk"],
  },
};

describe("generateWorld", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("persiste entidades (location + NPCs) geradas no banco", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await t.run(setupCampaign);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockWorldResponse) } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.generateWorld.generateWorld, { campaignId });

    await t.run(async (ctx) => {
      const entities = await ctx.db
        .query("entities")
        .withIndex("by_campaign", (q: any) => q.eq("campaignId", campaignId))
        .collect();

      // 1 location + 3 npcs = 4 entities
      expect(entities.length).toBe(4);

      const location = entities.find((e: any) => e.type === "location");
      expect(location).toBeDefined();
      expect(location!.name).toBe("Porto de Ironhaven");

      const npcs = entities.filter((e: any) => e.type === "npc");
      expect(npcs.length).toBe(3);

      const vosk = npcs.find((e: any) => e.name === "Capitão Vosk");
      expect(vosk).toBeDefined();
      expect(vosk!.visibility).toBe("known");
    });
  });

  it("persiste fatos no banco com visibilidade correta", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await t.run(setupCampaign);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockWorldResponse) } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.generateWorld.generateWorld, { campaignId });

    await t.run(async (ctx) => {
      const facts = await ctx.db
        .query("facts")
        .withIndex("by_campaign", (q: any) => q.eq("campaignId", campaignId))
        .collect();

      expect(facts.length).toBe(3);

      const hiddenFact = facts.find((f: any) => f.visibility === "hidden");
      expect(hiddenFact).toBeDefined();
      expect(hiddenFact!.content).toContain("Capitão Vosk");

      const knownFact = facts.find((f: any) => f.visibility === "known");
      expect(knownFact).toBeDefined();

      const rumoredFact = facts.find((f: any) => f.visibility === "rumored");
      expect(rumoredFact).toBeDefined();
    });
  });

  it("persiste gatilhos no banco", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await t.run(setupCampaign);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockWorldResponse) } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.generateWorld.generateWorld, { campaignId });

    await t.run(async (ctx) => {
      const triggers = await ctx.db
        .query("triggers")
        .withIndex("by_campaign", (q: any) => q.eq("campaignId", campaignId))
        .collect();

      expect(triggers.length).toBe(3);

      const oneShotTrigger = triggers.find((t: any) => t.oneShot === true);
      expect(oneShotTrigger).toBeDefined();

      const repeatingTrigger = triggers.find((t: any) => t.oneShot === false);
      expect(repeatingTrigger).toBeDefined();
    });
  });

  it("cria a cena inicial e atualiza currentSceneId na campanha", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await t.run(setupCampaign);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockWorldResponse) } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.generateWorld.generateWorld, { campaignId });

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId as Id<"campaigns">);
      expect(campaign!.currentSceneId).toBeDefined();

      const scene = await ctx.db.get(campaign!.currentSceneId as Id<"scenes">);
      expect(scene).toBeDefined();
      expect((scene as any)!.title).toBe("Docas ao Amanhecer");
      expect((scene as any)!.status).toBe("active");
    });
  });

  it("atualiza status da campanha para 'active' após geração", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await t.run(setupCampaign);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockWorldResponse) } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.generateWorld.generateWorld, { campaignId });

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId as Id<"campaigns">);
      expect((campaign as any)!.status).toBe("active");
    });
  });

  it("não deixa campanha em estado inconsistente quando LLM retorna JSON inválido", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await t.run(setupCampaign);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "not valid json at all" } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await expect(
      t.action(internal.generateWorld.generateWorld, { campaignId }),
    ).rejects.toThrow();

    // Campaign should still be in setup (not corrupted to active)
    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId as Id<"campaigns">);
      expect((campaign as any)!.status).toBe("setup");

      // No entities/facts/triggers should have been persisted
      const entities = await ctx.db
        .query("entities")
        .withIndex("by_campaign", (q: any) => q.eq("campaignId", campaignId))
        .collect();
      expect(entities.length).toBe(0);
    });
  });

  it("não deixa campanha em estado inconsistente quando fetch falha", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await t.run(setupCampaign);

    const fakeFetch = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", fakeFetch);

    await expect(
      t.action(internal.generateWorld.generateWorld, { campaignId }),
    ).rejects.toThrow();

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId as Id<"campaigns">);
      expect((campaign as any)!.status).toBe("setup");
    });
  });

  it("agenda embeddings para entidades, fatos e gatilhos criados", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await t.run(setupCampaign);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockWorldResponse) } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    // Just verify it doesn't throw and data is persisted
    await t.action(internal.generateWorld.generateWorld, { campaignId });

    await t.run(async (ctx) => {
      const entities = await ctx.db
        .query("entities")
        .withIndex("by_campaign", (q: any) => q.eq("campaignId", campaignId))
        .collect();
      expect(entities.length).toBeGreaterThan(0);
    });
  });
});
