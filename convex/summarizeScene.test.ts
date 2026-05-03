/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupCampaignWithScene(ctx: any) {
  const userId = await ctx.db.insert("users", {
    email: "gm@test.com",
    displayName: "GM",
    tokenIdentifier: "token|summarize001",
  });
  const campaignId = await ctx.db.insert("campaigns", {
    userId,
    name: "Test Campaign",
    premise: "Um herói busca redenção num mundo em ruínas",
    tone: "dark",
    expectedDuration: "medium",
    status: "active",
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  });
  const sceneId = await ctx.db.insert("scenes", {
    campaignId,
    title: "A Taverna dos Lamentos",
    description: "Uma taverna sombria no sul da cidade",
    status: "completed",
    createdAt: Date.now(),
  });
  return { userId, campaignId, sceneId };
}

describe("summarizeScene", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("persiste um documento em summaries com level 'scene'", async () => {
    const t = convexTest(schema, modules);

    const { campaignId, sceneId } = await t.run(setupCampaignWithScene);

    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "player",
        content: "Eu entro na taverna e procuro o taverneiro.",
        clientMessageId: "msg-001",
        status: "complete",
        createdAt: Date.now() - 2000,
      });
      await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "gm",
        content: "O taverneiro acena com a cabeça e diz que tem informações.",
        clientMessageId: "msg-002",
        status: "complete",
        createdAt: Date.now() - 1000,
      });
    });

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "O herói entrou na taverna e obteve informações valiosas do taverneiro.",
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.summarizeScene.summarizeScene, { sceneId });

    const summaries = await t.run(async (ctx) => {
      return ctx.db
        .query("summaries")
        .withIndex("by_campaign_level", (q) =>
          q.eq("campaignId", campaignId).eq("level", "scene"),
        )
        .collect();
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0].level).toBe("scene");
    expect(summaries[0].campaignId).toEqual(campaignId);
  });

  it("persiste content correto no documento de sumário", async () => {
    const t = convexTest(schema, modules);

    const { campaignId, sceneId } = await t.run(setupCampaignWithScene);

    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "player",
        content: "Eu examino o mapa na parede.",
        clientMessageId: "msg-003",
        status: "complete",
        createdAt: Date.now() - 1000,
      });
    });

    const expectedContent = "O herói examinou o mapa e descobriu a localização da fortaleza.";
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: expectedContent } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.summarizeScene.summarizeScene, { sceneId });

    const summaries = await t.run(async (ctx) => {
      return ctx.db.query("summaries").collect();
    });

    expect(summaries[0].content).toBe(expectedContent);
  });

  it("persiste sourceMessageIds com os ids das mensagens da cena", async () => {
    const t = convexTest(schema, modules);

    const { campaignId, sceneId } = await t.run(setupCampaignWithScene);

    const [msgId1, msgId2] = await t.run(async (ctx) => {
      const id1 = await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "player",
        content: "Ação do jogador.",
        clientMessageId: "msg-004",
        status: "complete",
        createdAt: Date.now() - 2000,
      });
      const id2 = await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "gm",
        content: "Resposta do GM.",
        clientMessageId: "msg-005",
        status: "complete",
        createdAt: Date.now() - 1000,
      });
      return [id1, id2];
    });

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Resumo da cena." } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.summarizeScene.summarizeScene, { sceneId });

    const summaries = await t.run(async (ctx) => {
      return ctx.db.query("summaries").collect();
    });

    expect(summaries[0].sourceMessageIds).toContain(msgId1);
    expect(summaries[0].sourceMessageIds).toContain(msgId2);
  });

  it("persiste sourceSceneIds com o sceneId fornecido", async () => {
    const t = convexTest(schema, modules);

    const { campaignId, sceneId } = await t.run(setupCampaignWithScene);

    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "player",
        content: "Mensagem.",
        clientMessageId: "msg-006",
        status: "complete",
        createdAt: Date.now() - 1000,
      });
    });

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Resumo." } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.summarizeScene.summarizeScene, { sceneId });

    const summaries = await t.run(async (ctx) => {
      return ctx.db.query("summaries").collect();
    });

    expect(summaries[0].sourceSceneIds).toEqual([sceneId]);
  });

  it("persiste coversFrom e coversTo com timestamps das mensagens", async () => {
    const t = convexTest(schema, modules);

    const { campaignId, sceneId } = await t.run(setupCampaignWithScene);

    const firstTime = Date.now() - 5000;
    const lastTime = Date.now() - 1000;

    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "player",
        content: "Primeira mensagem.",
        clientMessageId: "msg-007",
        status: "complete",
        createdAt: firstTime,
      });
      await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "gm",
        content: "Última mensagem.",
        clientMessageId: "msg-008",
        status: "complete",
        createdAt: lastTime,
      });
    });

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Resumo." } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.summarizeScene.summarizeScene, { sceneId });

    const summaries = await t.run(async (ctx) => {
      return ctx.db.query("summaries").collect();
    });

    expect(summaries[0].coversFrom).toBe(firstTime);
    expect(summaries[0].coversTo).toBe(lastTime);
  });
});
