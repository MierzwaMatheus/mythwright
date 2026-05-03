import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { buildArcSummarizerPrompt, parseArcSummarizerResponse } from "./prompts/arcSummarizer";

export const _getSceneSummaries = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("summaries")
      .withIndex("by_campaign_level", (q) =>
        q.eq("campaignId", args.campaignId).eq("level", "scene"),
      )
      .order("asc")
      .take(200);
  },
});

export const _insertArcSummary = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    content: v.string(),
    sourceSummaryIds: v.array(v.id("summaries")),
    sourceSceneIds: v.array(v.id("scenes")),
    coversFrom: v.number(),
    coversTo: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"summaries">> => {
    return await ctx.db.insert("summaries", {
      campaignId: args.campaignId,
      level: "arc",
      content: args.content,
      sourceSummaryIds: args.sourceSummaryIds,
      sourceSceneIds: args.sourceSceneIds,
      coversFrom: args.coversFrom,
      coversTo: args.coversTo,
      createdAt: Date.now(),
    });
  },
});

export const summarizeArc = internalAction({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const sceneSummaries = await ctx.runQuery(internal.summarizeArc._getSceneSummaries, {
      campaignId: args.campaignId,
    });

    if (sceneSummaries.length === 0) return null;

    const sceneSummariesBlock = sceneSummaries
      .map((s, i) => `=== Cena ${i + 1} ===\n${s.content}`)
      .join("\n\n");

    const campaign = await ctx.runQuery(internal.lib.llmConfig.getLlmConfigInternal, {
      campaignId: args.campaignId,
    });

    // Busca a premissa da campanha separadamente via uma query auxiliar
    const campaignDoc = await ctx.runQuery(internal.summarizeArc._getCampaign, {
      campaignId: args.campaignId,
    });

    if (!campaignDoc) return null;

    const prompt = buildArcSummarizerPrompt(campaignDoc.premise, sceneSummariesBlock);

    const apiKey = process.env.OPENROUTER_API_KEY;
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: campaign.narrativeModel,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const responseData = await response.json();
    const raw = responseData.choices[0].message.content;
    const content = parseArcSummarizerResponse(raw);

    const sourceSummaryIds = sceneSummaries.map((s) => s._id);
    const sourceSceneIds = sceneSummaries
      .flatMap((s) => s.sourceSceneIds ?? []);

    const allTimestamps = [
      ...sceneSummaries.map((s) => s.coversFrom),
      ...sceneSummaries.map((s) => s.coversTo),
    ];
    const coversFrom = Math.min(...allTimestamps);
    const coversTo = Math.max(...allTimestamps);

    const summaryId: Id<"summaries"> = await ctx.runMutation(
      internal.summarizeArc._insertArcSummary,
      {
        campaignId: args.campaignId,
        content,
        sourceSummaryIds,
        sourceSceneIds,
        coversFrom,
        coversTo,
      },
    );

    await ctx.scheduler.runAfter(0, internal.lib.embedding.embedSummary, { summaryId });

    return summaryId;
  },
});

export const _getCampaign = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.campaignId);
  },
});
