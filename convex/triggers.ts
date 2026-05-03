import { ConvexError, v } from "convex/values";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
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

export const createTrigger = mutation({
  args: {
    campaignId: v.id("campaigns"),
    description: v.string(),
    scope: v.string(),
    effects: v.array(v.object({ type: v.string(), payload: v.any() })),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");
    await assertCampaignOwnership(ctx, args.campaignId, user._id);
    return await ctx.db.insert("triggers", {
      campaignId: args.campaignId,
      description: args.description,
      scope: args.scope,
      effects: args.effects,
      status: "armed",
    });
  },
});

export const updateTriggerStatus = mutation({
  args: {
    triggerId: v.id("triggers"),
    status: v.union(v.literal("armed"), v.literal("disabled")),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    const trigger = await ctx.db.get(args.triggerId);
    if (!trigger) throw new ConvexError("Trigger not found");

    await assertCampaignOwnership(ctx, trigger.campaignId, user._id);
    await ctx.db.patch(args.triggerId, { status: args.status });
  },
});

export const getArmedTriggersByScope = query({
  args: {
    campaignId: v.id("campaigns"),
    sceneId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const triggers = await ctx.db
      .query("triggers")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .collect();

    return triggers.filter(
      (t) =>
        t.status === "armed" &&
        (t.scope === "global" || t.scope === args.sceneId),
    );
  },
});
