import { ConvexError, v } from "convex/values";
import { mutation, MutationCtx } from "./_generated/server";
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
