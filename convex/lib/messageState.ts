import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const markMessageStatus = internalMutation({
  args: {
    messageId: v.id("messages"),
    status: v.union(v.literal("pending"), v.literal("complete"), v.literal("failed"), v.literal("leaked")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { status: args.status });
  },
});

export const updateGmMessageContent = internalMutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
    toolCalls: v.optional(v.array(v.object({
      toolName: v.string(),
      toolParams: v.any(),
      toolResult: v.any(),
      executedAt: v.number(),
    }))),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      content: args.content,
      ...(args.toolCalls !== undefined ? { toolCalls: args.toolCalls } : {}),
    });
  },
});
