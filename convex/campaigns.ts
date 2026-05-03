import { ConvexError, v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";

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

const VALID_TRANSITIONS: Record<string, string[]> = {
  setup: ["active"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: [],
};

export const updateCampaignStatus = mutation({
  args: {
    campaignId: v.id("campaigns"),
    newStatus: v.union(v.literal("active"), v.literal("paused"), v.literal("archived")),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new ConvexError("Campaign not found");

    if (campaign.userId !== user._id) throw new ConvexError("Unauthorized");

    const allowed = VALID_TRANSITIONS[campaign.status] ?? [];
    if (!allowed.includes(args.newStatus)) {
      throw new ConvexError(
        `Invalid status transition: ${campaign.status} → ${args.newStatus}`
      );
    }

    await ctx.db.patch(args.campaignId, {
      status: args.newStatus,
      lastActivityAt: Date.now(),
    });
  },
});

export const updateCampaignConfig = mutation({
  args: {
    campaignId: v.id("campaigns"),
    tone: v.optional(v.string()),
    premise: v.optional(v.string()),
    cheatModeEnabled: v.optional(v.boolean()),
    antiLeakValidationEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new ConvexError("Campaign not found");

    if (campaign.userId !== user._id) throw new ConvexError("Unauthorized");

    const patch: Partial<{
      tone: string;
      premise: string;
      cheatModeEnabled: boolean;
      antiLeakValidationEnabled: boolean;
    }> = {};

    if (args.tone !== undefined) patch.tone = args.tone;
    if (args.premise !== undefined) patch.premise = args.premise;
    if (args.cheatModeEnabled !== undefined) patch.cheatModeEnabled = args.cheatModeEnabled;
    if (args.antiLeakValidationEnabled !== undefined) patch.antiLeakValidationEnabled = args.antiLeakValidationEnabled;

    await ctx.db.patch(args.campaignId, patch);
  },
});

const CHILD_TABLES = [
  "characters",
  "scenes",
  "messages",
  "entities",
  "facts",
  "triggers",
  "summaries",
  "diceRolls",
] as const;

export const deleteCampaign = mutation({
  args: {
    campaignId: v.id("campaigns"),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new ConvexError("Campaign not found");

    if (campaign.userId !== user._id) throw new ConvexError("Unauthorized");

    for (const table of CHILD_TABLES) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
        .collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
    }

    await ctx.db.delete(args.campaignId);
  },
});

export const getByIdInternal = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.campaignId);
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
