/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupCampaignWithSceneSummaries(ctx: any) {
  const userId = await ctx.db.insert("users", {
    email: "arc@test.com",
    displayName: "GM Arc",
    tokenIdentifier: "token|arc001",
  });
  const campaignId = await ctx.db.insert("campaigns", {
    userId,
    name: "Arc Campaign",
    premise: "Um herói combate as forças do caos",
    tone: "epic",
    expectedDuration: "long",
    status: "active",
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  });
  const sceneId1 = await ctx.db.insert("scenes", {
    campaignId,
    title: "Cena 1",
    description: "Primeira cena",
    status: "completed",
    createdAt: Date.now() - 5000,
  });
  const sceneId2 = await ctx.db.insert("scenes", {
    campaignId,
    title: "Cena 2",
    description: "Segunda cena",
    status: "completed",
    createdAt: Date.now() - 3000,
  });
  const summaryId1 = await ctx.db.insert("summaries", {
    campaignId,
    level: "scene" as const,
    content: "Resumo da primeira cena do arco.",
    sourceSceneIds: [sceneId1],
    coversFrom: Date.now() - 5000,
    coversTo: Date.now() - 4000,
    createdAt: Date.now() - 4000,
  });
  const summaryId2 = await ctx.db.insert("summaries", {
    campaignId,
    level: "scene" as const,
    content: "Resumo da segunda cena do arco.",
    sourceSceneIds: [sceneId2],
    coversFrom: Date.now() - 3000,
    coversTo: Date.now() - 2000,
    createdAt: Date.now() - 2000,
  });
  return { userId, campaignId, sceneId1, sceneId2, summaryId1, summaryId2 };
}

describe("summarizeArc", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("persiste um documento em summaries com level 'arc'", async () => {
    const t = convexTest(schema, modules);

    const { campaignId } = await t.run(setupCampaignWithSceneSummaries);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "O herói atravessou dois desafios e ganhou um aliado importante.",
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.summarizeArc.summarizeArc, { campaignId });

    const arcSummaries = await t.run(async (ctx) => {
      return ctx.db
        .query("summaries")
        .withIndex("by_campaign_level", (q) =>
          q.eq("campaignId", campaignId).eq("level", "arc"),
        )
        .collect();
    });

    expect(arcSummaries).toHaveLength(1);
    expect(arcSummaries[0].level).toBe("arc");
  });

  it("persiste sourceSummaryIds com os ids dos sumários de cena", async () => {
    const t = convexTest(schema, modules);

    const { campaignId, summaryId1, summaryId2 } = await t.run(setupCampaignWithSceneSummaries);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Resumo de arco." } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.summarizeArc.summarizeArc, { campaignId });

    const arcSummaries = await t.run(async (ctx) => {
      return ctx.db.query("summaries").withIndex("by_campaign_level", (q) =>
        q.eq("campaignId", campaignId).eq("level", "arc"),
      ).collect();
    });

    expect(arcSummaries[0].sourceSummaryIds).toContain(summaryId1);
    expect(arcSummaries[0].sourceSummaryIds).toContain(summaryId2);
  });

  it("agrega sourceSceneIds de todos os sumários de cena", async () => {
    const t = convexTest(schema, modules);

    const { campaignId, sceneId1, sceneId2 } = await t.run(setupCampaignWithSceneSummaries);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Resumo de arco." } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.summarizeArc.summarizeArc, { campaignId });

    const arcSummaries = await t.run(async (ctx) => {
      return ctx.db.query("summaries").withIndex("by_campaign_level", (q) =>
        q.eq("campaignId", campaignId).eq("level", "arc"),
      ).collect();
    });

    expect(arcSummaries[0].sourceSceneIds).toContain(sceneId1);
    expect(arcSummaries[0].sourceSceneIds).toContain(sceneId2);
  });

  it("não persiste nada quando não há sumários de cena", async () => {
    const t = convexTest(schema, modules);

    const campaignId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "empty@test.com",
        displayName: "Empty GM",
        tokenIdentifier: "token|empty001",
      });
      return ctx.db.insert("campaigns", {
        userId,
        name: "Empty Campaign",
        premise: "Premissa",
        tone: "light",
        expectedDuration: "one-shot",
        status: "setup",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
    });

    const fakeFetch = vi.fn();
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.summarizeArc.summarizeArc, { campaignId });

    const summaries = await t.run(async (ctx) => {
      return ctx.db.query("summaries").collect();
    });

    expect(summaries).toHaveLength(0);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("inclui o content do LLM no sumário de arco", async () => {
    const t = convexTest(schema, modules);

    const { campaignId } = await t.run(setupCampaignWithSceneSummaries);

    const expectedContent = "Este arco narrou a jornada do herói desde a aldeia até a fortaleza.";
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: expectedContent } }],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.summarizeArc.summarizeArc, { campaignId });

    const arcSummaries = await t.run(async (ctx) => {
      return ctx.db.query("summaries").withIndex("by_campaign_level", (q) =>
        q.eq("campaignId", campaignId).eq("level", "arc"),
      ).collect();
    });

    expect(arcSummaries[0].content).toBe(expectedContent);
  });
});
