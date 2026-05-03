import { v } from "convex/values";
import { internalAction, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { buildSceneSummarizerPrompt, parseSceneSummarizerResponse } from "./prompts/sceneSummarizer";

export const _getSceneWithMessages = internalQuery({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const scene = await ctx.db.get(args.sceneId);
    if (!scene) return null;

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_scene_and_createdAt", (q) => q.eq("sceneId", args.sceneId))
      .order("asc")
      .take(500);

    return { scene, messages };
  },
});

export const summarizeScene = internalAction({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.summarizeScene._getSceneWithMessages, {
      sceneId: args.sceneId,
    });

    if (!data) return null;

    const { scene, messages } = data;

    const messagesBlock = messages
      .map((m) => {
        const role = m.role === "player" ? "Jogador" : "GM";
        return `[${role}]: ${m.content}`;
      })
      .join("\n");

    const llmConfig = await ctx.runQuery(internal.lib.llmConfig.getLlmConfigInternal, {
      campaignId: scene.campaignId,
    });

    const prompt = buildSceneSummarizerPrompt(
      scene.title,
      scene.description ?? "",
      messagesBlock,
    );

    const apiKey = process.env.OPENROUTER_API_KEY;
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: llmConfig.utilityModel,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const responseData = await response.json();
    const raw = responseData.choices[0].message.content;
    const content = parseSceneSummarizerResponse(raw);

    const sourceMessageIds = messages.map((m) => m._id);
    const timestamps = messages
      .map((m) => m.createdAt)
      .filter((t): t is number => typeof t === "number");

    const coversFrom = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
    const coversTo = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();

    const summaryId: Id<"summaries"> = await ctx.runMutation(
      internal.summarizeScene._insertSummary,
      {
        campaignId: scene.campaignId,
        level: "scene",
        content,
        sourceMessageIds,
        sourceSceneIds: [args.sceneId],
        coversFrom,
        coversTo,
      },
    );

    await ctx.scheduler.runAfter(0, internal.lib.embedding.embedSummary, { summaryId });

    return summaryId;
  },
});

export const _insertSummary = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    level: v.union(v.literal("scene"), v.literal("arc"), v.literal("campaign")),
    content: v.string(),
    sourceMessageIds: v.array(v.id("messages")),
    sourceSceneIds: v.array(v.id("scenes")),
    coversFrom: v.number(),
    coversTo: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"summaries">> => {
    return await ctx.db.insert("summaries", {
      campaignId: args.campaignId,
      level: args.level,
      content: args.content,
      sourceMessageIds: args.sourceMessageIds,
      sourceSceneIds: args.sourceSceneIds,
      coversFrom: args.coversFrom,
      coversTo: args.coversTo,
      createdAt: Date.now(),
    });
  },
});
