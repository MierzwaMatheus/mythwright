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

export const finalizeMessage = mutation({
  args: {
    messageId: v.id("messages"),
    status: v.union(v.literal("complete"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (message === null) {
      throw new Error(`Message not found: ${args.messageId}`);
    }
    await ctx.db.patch(args.messageId, {
      status: args.status,
      finalizedAt: Date.now(),
    });
  },
});

export const appendToolCall = mutation({
  args: {
    messageId: v.id("messages"),
    toolName: v.string(),
    toolParams: v.any(),
    toolResult: v.any(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (message === null) {
      throw new Error(`Message not found: ${args.messageId}`);
    }
    const existing = message.toolCalls ?? [];
    await ctx.db.patch(args.messageId, {
      toolCalls: [
        ...existing,
        {
          toolName: args.toolName,
          toolParams: args.toolParams,
          toolResult: args.toolResult,
          executedAt: Date.now(),
        },
      ],
    });
  },
});

export const appendMessageTokens = mutation({
  args: {
    messageId: v.id("messages"),
    tokens: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (message === null) {
      throw new Error(`Message not found: ${args.messageId}`);
    }
    await ctx.db.patch(args.messageId, {
      content: message.content + args.tokens,
    });
  },
});
