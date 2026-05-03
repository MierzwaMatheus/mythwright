import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const upsertFromAuth = mutation({
  args: {
    displayName: v.string(),
    avatar: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const { tokenIdentifier, email } = identity;
    const resolvedEmail = email ?? "";

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
      .unique();

    const userData: {
      email: string;
      displayName: string;
      tokenIdentifier: string;
      avatar?: string;
    } = {
      email: resolvedEmail,
      displayName: args.displayName,
      tokenIdentifier,
    };

    if (args.avatar !== undefined) {
      userData.avatar = args.avatar;
    }

    if (existing) {
      await ctx.db.patch(existing._id, userData);
    } else {
      await ctx.db.insert("users", userData);
    }
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("users").take(100);
  },
});
