import { ConvexError, v } from "convex/values";
import { mutation, query, action, internalQuery, internalMutation, MutationCtx } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";
import { Doc, Id } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";

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

export const getTriggerById = internalQuery({
  args: { triggerId: v.id("triggers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.triggerId);
  },
});

export const markTriggerFired = internalMutation({
  args: { triggerId: v.id("triggers") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.triggerId, { status: "fired", firedAt: Date.now() });
  },
});

export const resolveTriggerEffects = action({
  args: { triggeredIds: v.array(v.id("triggers")) },
  handler: async (ctx, args) => {
    for (const triggerId of args.triggeredIds) {
      const trigger: Doc<"triggers"> | null = await ctx.runQuery(
        internal.triggers.getTriggerById,
        { triggerId },
      );

      if (!trigger) continue;
      if (trigger.status === "fired") continue;

      for (const effect of trigger.effects) {
        if (effect.type === "change_fact_visibility") {
          await ctx.runMutation(api.facts.changeFactVisibility, effect.payload);
        } else if (effect.type === "change_entity_visibility") {
          await ctx.runMutation(api.entities.changeEntityVisibility, effect.payload);
        }
      }

      await ctx.runMutation(internal.triggers.markTriggerFired, { triggerId });
    }
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
