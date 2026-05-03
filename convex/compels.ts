import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, MutationCtx } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";
import { Id } from "./_generated/dataModel";
import { api } from "./_generated/api";

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

export const beginCompelInternal = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    aspectId: v.id("sceneAspects"),
    characterId: v.id("characters"),
    complication: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"compels">> => {
    return await ctx.db.insert("compels", {
      campaignId: args.campaignId,
      aspectId: args.aspectId,
      characterId: args.characterId,
      complication: args.complication,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const resolveCompelInternal = internalMutation({
  args: {
    compelId: v.id("compels"),
    decision: v.union(v.literal("accept"), v.literal("refuse")),
  },
  handler: async (ctx, args) => {
    const compel = await ctx.db.get(args.compelId);
    if (!compel) throw new ConvexError("Compel not found");
    if (compel.status !== "pending") throw new ConvexError("Compel já resolvido");

    if (args.decision === "accept") {
      await ctx.db.patch(args.compelId, { status: "accepted", resolvedAt: Date.now() });
    } else {
      await ctx.db.patch(args.compelId, { status: "refused", resolvedAt: Date.now() });
    }
  },
});

export const resolveCompel = mutation({
  args: {
    compelId: v.id("compels"),
    decision: v.union(v.literal("accept"), v.literal("refuse")),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    const compel = await ctx.db.get(args.compelId);
    if (!compel) throw new ConvexError("Compel not found");

    await assertCampaignOwnership(ctx, compel.campaignId, user._id);

    if (compel.status !== "pending") throw new ConvexError("Compel já resolvido");

    if (args.decision === "accept") {
      const _: null = await ctx.runMutation(api.characters.awardFatePoint, {
        characterId: compel.characterId,
        reason: "Compel aceito",
      });
      await ctx.db.patch(args.compelId, { status: "accepted", resolvedAt: Date.now() });
    } else {
      const _: null = await ctx.runMutation(api.characters.spendFatePoint, {
        characterId: compel.characterId,
        reason: "Recusa de compel",
      });
      await ctx.db.patch(args.compelId, { status: "refused", resolvedAt: Date.now() });
    }
  },
});

export const beginCompel = mutation({
  args: {
    campaignId: v.id("campaigns"),
    aspectId: v.id("sceneAspects"),
    characterId: v.id("characters"),
    complication: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    await assertCampaignOwnership(ctx, args.campaignId, user._id);

    return await ctx.db.insert("compels", {
      campaignId: args.campaignId,
      aspectId: args.aspectId,
      characterId: args.characterId,
      complication: args.complication,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});
