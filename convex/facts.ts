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

const VALID_TRANSITIONS: Record<string, string[]> = {
  hidden: ["rumored", "known"],
  rumored: ["known"],
  known: [],
};

export const listFacts = query({
  args: {
    campaignId: v.id("campaigns"),
    visibility: v.optional(v.union(
      v.literal("hidden"),
      v.literal("rumored"),
      v.literal("known"),
    )),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    if (args.visibility !== undefined) {
      return await ctx.db
        .query("facts")
        .withIndex("by_campaign_and_visibility", (q) =>
          q.eq("campaignId", args.campaignId).eq("visibility", args.visibility!),
        )
        .take(100);
    }

    return await ctx.db
      .query("facts")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .take(100);
  },
});

export const changeFactVisibility = mutation({
  args: {
    factId: v.id("facts"),
    visibility: v.union(v.literal("hidden"), v.literal("rumored"), v.literal("known")),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    const fact = await ctx.db.get(args.factId);
    if (!fact) throw new ConvexError("Fact not found");

    await assertCampaignOwnership(ctx, fact.campaignId, user._id);

    const allowed = VALID_TRANSITIONS[fact.visibility] ?? [];
    if (!allowed.includes(args.visibility)) {
      throw new ConvexError(
        `Invalid transition: ${fact.visibility} → ${args.visibility}`,
      );
    }

    await ctx.db.patch(args.factId, { visibility: args.visibility });
  },
});

export const createFact = mutation({
  args: {
    campaignId: v.id("campaigns"),
    content: v.string(),
    visibility: v.union(v.literal("hidden"), v.literal("rumored"), v.literal("known")),
    relatedEntityIds: v.optional(v.array(v.id("entities"))),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");
    await assertCampaignOwnership(ctx, args.campaignId, user._id);
    return await ctx.db.insert("facts", {
      campaignId: args.campaignId,
      content: args.content,
      visibility: args.visibility,
      relatedEntityIds: args.relatedEntityIds,
    });
  },
});
