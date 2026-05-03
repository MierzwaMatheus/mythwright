import { ConvexError, v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
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

export const listEntities = query({
  args: {
    campaignId: v.id("campaigns"),
    visibility: v.optional(v.union(v.literal("hidden"), v.literal("rumored"), v.literal("known"))),
    type: v.optional(v.union(
      v.literal("npc"),
      v.literal("location"),
      v.literal("faction"),
      v.literal("item"),
      v.literal("concept"),
    )),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    if (args.visibility !== undefined) {
      return await ctx.db
        .query("entities")
        .withIndex("by_campaign_and_visibility", (q) =>
          q.eq("campaignId", args.campaignId).eq("visibility", args.visibility!),
        )
        .take(100);
    }

    if (args.type !== undefined) {
      return await ctx.db
        .query("entities")
        .withIndex("by_campaign_and_type", (q) =>
          q.eq("campaignId", args.campaignId).eq("type", args.type!),
        )
        .take(100);
    }

    return await ctx.db
      .query("entities")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .take(100);
  },
});

export const changeEntityVisibility = mutation({
  args: {
    entityId: v.id("entities"),
    visibility: v.union(v.literal("hidden"), v.literal("rumored"), v.literal("known")),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new ConvexError("Entity not found");

    await assertCampaignOwnership(ctx, entity.campaignId, user._id);
    await ctx.db.patch(args.entityId, { visibility: args.visibility });
  },
});

export const createEntity = mutation({
  args: {
    campaignId: v.id("campaigns"),
    type: v.union(
      v.literal("npc"),
      v.literal("location"),
      v.literal("faction"),
      v.literal("item"),
      v.literal("concept"),
    ),
    name: v.string(),
    visibility: v.union(v.literal("hidden"), v.literal("rumored"), v.literal("known")),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    await assertCampaignOwnership(ctx, args.campaignId, user._id);

    return await ctx.db.insert("entities", {
      campaignId: args.campaignId,
      type: args.type,
      name: args.name,
      visibility: args.visibility,
      description: args.description,
    });
  },
});
