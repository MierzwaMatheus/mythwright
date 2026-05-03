import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const createMessage = mutation({
  args: {
    campaignId: v.id("campaigns"),
    role: v.union(v.literal("player"), v.literal("gm"), v.literal("system")),
    content: v.string(),
    clientMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_campaign_and_clientMessageId", (q) =>
        q.eq("campaignId", args.campaignId).eq("clientMessageId", args.clientMessageId),
      )
      .unique();

    if (existing !== null) {
      return existing._id;
    }

    return await ctx.db.insert("messages", {
      campaignId: args.campaignId,
      role: args.role,
      content: args.content,
      clientMessageId: args.clientMessageId,
      status: "pending",
    });
  },
});
