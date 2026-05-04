import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const findBySceneInternal = internalQuery({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    // summaries table does not have a sceneId index directly,
    // so we check sourceSceneIds via a scan (limited)
    const summaries = await ctx.db
      .query("summaries")
      .order("desc")
      .take(50);
    return summaries.find(
      (s) => s.sourceSceneIds?.includes(args.sceneId) ?? false
    ) ?? null;
  },
});

export const listByCampaignLevelInternal = internalQuery({
  args: {
    campaignId: v.id("campaigns"),
    level: v.union(v.literal("scene"), v.literal("arc"), v.literal("campaign")),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("summaries")
      .withIndex("by_campaign_level", (q) =>
        q.eq("campaignId", args.campaignId).eq("level", args.level)
      )
      .order("desc")
      .take(10);
  },
});

export const getByIdInternal = internalQuery({
  args: { summaryId: v.id("summaries") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.summaryId);
  },
});

export const setSummaryEmbedding = internalMutation({
  args: {
    summaryId: v.id("summaries"),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.summaryId, { embedding: args.embedding });
  },
});
