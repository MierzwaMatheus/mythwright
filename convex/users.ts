import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { encryptValue, decryptValue } from "./lib/crypto";

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

export const saveOpenRouterKey = mutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user) {
      throw new ConvexError("User not found");
    }

    const encryptedOpenRouterKey = await encryptValue(args.key);
    await ctx.db.patch(user._id, { encryptedOpenRouterKey });
  },
});

export const getMyOpenRouterKey = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user || !user.encryptedOpenRouterKey) {
      return null;
    }

    return decryptValue(user.encryptedOpenRouterKey);
  },
});

