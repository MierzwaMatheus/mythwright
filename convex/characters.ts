import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";

export const createCharacter = mutation({
  args: {
    campaignId: v.id("campaigns"),
    name: v.string(),
    aspects: v.array(v.string()),
    skills: v.record(v.string(), v.number()),
    stunts: v.array(v.string()),
    fatePoints: v.optional(v.number()),
    stress: v.object({
      physical: v.array(v.boolean()),
      mental: v.array(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    if (args.aspects.length > 5) {
      throw new ConvexError("aspects cannot have more than 5 entries");
    }

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new ConvexError("Campaign not found");

    if (campaign.userId !== user._id) throw new ConvexError("Unauthorized");

    return await ctx.db.insert("characters", {
      campaignId: args.campaignId,
      name: args.name,
      aspects: args.aspects,
      skills: args.skills,
      stunts: args.stunts,
      fatePoints: args.fatePoints ?? 3,
      stress: args.stress,
      consequences: [],
    });
  },
});
