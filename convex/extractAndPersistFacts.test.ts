/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupCampaignAndMessage(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "gm@test.com",
      displayName: "GM",
      tokenIdentifier: "token|epf-" + Math.random(),
    });
    const campaignId = await ctx.db.insert("campaigns", {
      userId,
      name: "Campanha Extração",
      premise: "Aventura épica",
      tone: "dark",
      expectedDuration: "medium",
      status: "active",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    });
    const messageId = await ctx.db.insert("messages", {
      campaignId,
      role: "gm",
      content: "O cavaleiro encontrou uma caverna secreta ao norte da floresta.",
      clientMessageId: "msg-epf-" + Math.random(),
      status: "complete",
    });
    return { campaignId, messageId };
  });
}

describe("extractAndPersistFacts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persiste fatos novos e retorna array de IDs", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, messageId } = await setupCampaignAndMessage(t);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              facts: [
                { content: "O cavaleiro encontrou uma caverna.", visibility: "known", relatedEntityIds: [] },
                { content: "A caverna fica ao norte da floresta.", visibility: "known", relatedEntityIds: [] },
              ],
            }),
          },
        }],
      }),
    }));

    const result = await t.action(internal.prompts.factExtraction.extractAndPersistFacts, {
      messageId,
      campaignId,
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);

    await t.run(async (ctx) => {
      const facts = await ctx.db
        .query("facts")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .collect();
      expect(facts).toHaveLength(2);
    });
  });

  it("nao persiste fatos duplicados dos ja existentes", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, messageId } = await setupCampaignAndMessage(t);

    // Pre-inserir fato existente
    await t.run(async (ctx) => {
      await ctx.db.insert("facts", {
        campaignId,
        content: "O cavaleiro encontrou uma caverna.",
        visibility: "known",
      });
    });

    // LLM retorna o mesmo fato + um novo
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              facts: [
                { content: "O cavaleiro encontrou uma caverna.", visibility: "known", relatedEntityIds: [] },
                { content: "A caverna guarda um tesouro antigo.", visibility: "hidden", relatedEntityIds: [] },
              ],
            }),
          },
        }],
      }),
    }));

    const result = await t.action(internal.prompts.factExtraction.extractAndPersistFacts, {
      messageId,
      campaignId,
    });

    // Apenas 1 fato novo deve ser persistido (o duplicado é descartado)
    expect(result).toHaveLength(1);

    await t.run(async (ctx) => {
      const facts = await ctx.db
        .query("facts")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .collect();
      // 1 pre-existente + 1 novo = 2 total
      expect(facts).toHaveLength(2);
    });
  });

  it("retorna array vazio quando LLM nao extrai fatos novos", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, messageId } = await setupCampaignAndMessage(t);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({ facts: [] }),
          },
        }],
      }),
    }));

    const result = await t.action(internal.prompts.factExtraction.extractAndPersistFacts, {
      messageId,
      campaignId,
    });

    expect(result).toEqual([]);
  });
});
