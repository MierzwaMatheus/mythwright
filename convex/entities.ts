import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";
import { Id } from "./_generated/dataModel";
import { MutationCtx } from "./_generated/server";

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
    visibility: v.union(v.literal("hidden"), v.literal("known")),
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
