import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";

export const createCampaign = mutation({
  args: {
    name: v.string(),
    premise: v.string(),
    tone: v.string(),
    expectedDuration: v.union(v.literal("one-shot"), v.literal("medium"), v.literal("long")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError("User not found");

    const now = Date.now();

    return await ctx.db.insert("campaigns", {
      userId: user._id,
      name: args.name,
      premise: args.premise,
      tone: args.tone,
      expectedDuration: args.expectedDuration,
      status: "setup",
      createdAt: now,
      lastActivityAt: now,
    });
  },
});
