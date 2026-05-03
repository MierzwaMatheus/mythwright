import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthenticatedUser } from "./lib/auth";
import { Id } from "./_generated/dataModel";

async function assertCampaignOwnership(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  userId: Id<"users">,
) {
  const campaign = await ctx.db.get(campaignId);
  if (!campaign) throw new ConvexError("Campaign not found");
  if (campaign.userId !== userId) throw new ConvexError("Unauthorized");
  return campaign;
}

export const createScene = mutation({
  args: {
    campaignId: v.id("campaigns"),
    title: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    await assertCampaignOwnership(ctx, args.campaignId, user._id);

    return await ctx.db.insert("scenes", {
      campaignId: args.campaignId,
      title: args.title,
      description: args.description,
      status: "inactive",
      createdAt: Date.now(),
    });
  },
});

export const listScenes = query({
  args: {
    campaignId: v.id("campaigns"),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    return await ctx.db
      .query("scenes")
      .withIndex("by_campaign_created", (q) => q.eq("campaignId", args.campaignId))
      .order("desc")
      .take(100);
  },
});

export const summarizeScene = internalMutation({
  args: {
    sceneId: v.id("scenes"),
  },
  handler: async (_ctx, _args) => {
    // stub — será implementado futuramente
    return null;
  },
});

export const changeScene = mutation({
  args: {
    campaignId: v.id("campaigns"),
    newSceneTitle: v.string(),
    newSceneDescription: v.optional(v.string()),
    newLocationId: v.optional(v.id("entities")),
    presentEntityIds: v.array(v.id("entities")),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    await assertCampaignOwnership(ctx, args.campaignId, user._id);

    const activeScene = await ctx.db
      .query("scenes")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .unique();

    if (!activeScene) throw new ConvexError("No active scene found");

    await ctx.db.patch(activeScene._id, {
      status: "completed",
      endedAt: Date.now(),
    });

    const newSceneId = await ctx.db.insert("scenes", {
      campaignId: args.campaignId,
      title: args.newSceneTitle,
      description: args.newSceneDescription,
      status: "active",
      createdAt: Date.now(),
      locationId: args.newLocationId,
      presentEntityIds: args.presentEntityIds,
    });

    await ctx.scheduler.runAfter(0, internal.scenes.summarizeScene, {
      sceneId: activeScene._id,
    });

    return newSceneId;
  },
});

export const updateSceneStatus = mutation({
  args: {
    sceneId: v.id("scenes"),
    status: v.union(v.literal("inactive"), v.literal("active"), v.literal("completed")),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    const scene = await ctx.db.get(args.sceneId);
    if (!scene) throw new ConvexError("Scene not found");

    await assertCampaignOwnership(ctx, scene.campaignId, user._id);

    await ctx.db.patch(args.sceneId, { status: args.status });
  },
});
