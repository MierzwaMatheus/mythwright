import { ConvexError, v } from "convex/values";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";

async function getAuthenticatedUser(ctx: MutationCtx | QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Not authenticated");

  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export const createCampaign = mutation({
  args: {
    name: v.string(),
    premise: v.string(),
    tone: v.string(),
    expectedDuration: v.union(v.literal("one-shot"), v.literal("medium"), v.literal("long")),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
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

export const listCampaigns = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return [];

    return await ctx.db
      .query("campaigns")
      .withIndex("by_user_activity", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
  },
});
