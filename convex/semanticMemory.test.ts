/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function makeFakeEmbedding(seed = 0, size = 1024): number[] {
  return Array.from({ length: size }, (_, i) => ((i + seed) % 100) * 0.01);
}

async function setupCampaign(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "sm@test.com",
      displayName: "GM",
      tokenIdentifier: "token|sm001",
    });
    const campaignId = await ctx.db.insert("campaigns", {
      userId,
      name: "Campanha Semântica",
      premise: "Um teste de recuperação semântica",
      tone: "dark",
      expectedDuration: "medium",
      status: "setup",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    });
    return { userId, campaignId };
  });
}

describe("retrieveSemanticContext", () => {
  it("retorna facts com visibility known ou rumored filtrados por campaignId", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    const queryEmbedding = makeFakeEmbedding(0);

    await t.run(async (ctx) => {
      await ctx.db.insert("facts", {
        campaignId,
        content: "O rei está morto",
        visibility: "known",
        embedding: makeFakeEmbedding(1),
      });
      await ctx.db.insert("facts", {
        campaignId,
        content: "Existe um tesouro oculto",
        visibility: "rumored",
        embedding: makeFakeEmbedding(2),
      });
      await ctx.db.insert("facts", {
        campaignId,
        content: "Segredo escondido",
        visibility: "hidden",
        embedding: makeFakeEmbedding(3),
      });
    });

    const result = await t.action(internal.lib.semanticMemory.retrieveSemanticContextAction, {
      campaignId,
      queryEmbedding,
      limits: { facts: 5, entities: 5, summaries: 3 },
    });

    expect(result.facts.length).toBeGreaterThanOrEqual(1);
    for (const f of result.facts) {
      expect(["known", "rumored"]).toContain(f.visibility);
    }
    const contents = result.facts.map((f) => f.content);
    expect(contents).not.toContain("Segredo escondido");
  });

  it("retorna entities com visibility known ou rumored", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    const queryEmbedding = makeFakeEmbedding(0);

    await t.run(async (ctx) => {
      await ctx.db.insert("entities", {
        campaignId,
        type: "npc",
        name: "Aragorn",
        visibility: "known",
        description: "Um ranger do norte",
        embedding: makeFakeEmbedding(1),
      });
      await ctx.db.insert("entities", {
        campaignId,
        type: "npc",
        name: "Sombra",
        visibility: "hidden",
        description: "Uma figura misteriosa",
        embedding: makeFakeEmbedding(2),
      });
    });

    const result = await t.action(internal.lib.semanticMemory.retrieveSemanticContextAction, {
      campaignId,
      queryEmbedding,
      limits: { facts: 5, entities: 5, summaries: 3 },
    });

    const entityNames = result.entities.map((e) => e.name);
    expect(entityNames).toContain("Aragorn");
    expect(entityNames).not.toContain("Sombra");
  });

  it("retorna summaries de level scene ou arc", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    const queryEmbedding = makeFakeEmbedding(0);

    await t.run(async (ctx) => {
      await ctx.db.insert("summaries", {
        campaignId,
        level: "scene",
        content: "Os heróis entraram na taverna",
        coversFrom: Date.now() - 1000,
        coversTo: Date.now(),
        createdAt: Date.now(),
        embedding: makeFakeEmbedding(1),
      });
      await ctx.db.insert("summaries", {
        campaignId,
        level: "campaign",
        content: "Resumo geral da campanha",
        coversFrom: Date.now() - 10000,
        coversTo: Date.now(),
        createdAt: Date.now(),
        embedding: makeFakeEmbedding(2),
      });
    });

    const result = await t.action(internal.lib.semanticMemory.retrieveSemanticContextAction, {
      campaignId,
      queryEmbedding,
      limits: { facts: 5, entities: 5, summaries: 3 },
    });

    const levels = result.summaries.map((s) => s.level);
    expect(levels).toContain("scene");
    expect(levels).not.toContain("campaign");
  });

  it("executa consultas em paralelo e retorna SemanticContext vazio quando não há dados", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    const result = await t.action(internal.lib.semanticMemory.retrieveSemanticContextAction, {
      campaignId,
      queryEmbedding: makeFakeEmbedding(0),
    });

    expect(result.facts).toEqual([]);
    expect(result.entities).toEqual([]);
    expect(result.summaries).toEqual([]);
  });
});
