import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

export const getMessagesByScene = query({
  args: {
    sceneId: v.id("scenes"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_scene_and_createdAt", (q) => q.eq("sceneId", args.sceneId))
      .order("asc")
      .paginate(args.paginationOpts);
  },
});

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

export const getMessageContent = query({
  args: {
    messageId: v.id("messages"),
  },
  handler: async (ctx, args): Promise<string> => {
    const message = await ctx.db.get(args.messageId);
    if (message === null) {
      throw new Error(`Message not found: ${args.messageId}`);
    }
    return message.content;
  },
});

export const getByIdInternal = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.messageId);
  },
});

export const findGmByCausedByInternal = internalQuery({
  args: { causedByMessageId: v.id("messages") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_caused_by", (q) => q.eq("causedByMessageId", args.causedByMessageId))
      .filter((q) => q.eq(q.field("role"), "gm"))
      .first();
  },
});

export const createGmStubInternal = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    causedByMessageId: v.id("messages"),
    sceneId: v.optional(v.id("scenes")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", {
      campaignId: args.campaignId,
      role: "gm",
      content: "",
      clientMessageId: "gm-" + Date.now() + "-" + Math.random(),
      status: "pending",
      createdAt: Date.now(),
      causedByMessageId: args.causedByMessageId,
      ...(args.sceneId !== undefined ? { sceneId: args.sceneId } : {}),
    });
  },
});

export const finalizeTurnMessageInternal = internalMutation({
  args: {
    gmMessageId: v.id("messages"),
    triggersFired: v.array(v.id("triggers")),
    factsRevealed: v.array(v.id("facts")),
    tokensUsed: v.optional(v.object({ input: v.number(), output: v.number() })),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.gmMessageId, {
      status: "complete",
      finalizedAt: Date.now(),
      triggersFired: args.triggersFired,
      factsRevealed: args.factsRevealed,
      ...(args.tokensUsed !== undefined ? { tokensUsed: args.tokensUsed } : {}),
    });
    const gmMessage = await ctx.db.get(args.gmMessageId);
    if (gmMessage) {
      await ctx.db.patch(gmMessage.campaignId, { lastActivityAt: Date.now() });
    }
  },
});

export const countBySceneInternal = internalQuery({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_scene_and_createdAt", (q) => q.eq("sceneId", args.sceneId))
      .take(100);
    return msgs.length;
  },
});

export const getRecentBySceneInternal = internalQuery({
  args: { sceneId: v.id("scenes"), limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_scene_and_createdAt", (q) => q.eq("sceneId", args.sceneId))
      .order("desc")
      .take(args.limit);
  },
});

export const setEmbeddingInternal = internalMutation({
  args: {
    messageId: v.id("messages"),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { embedding: args.embedding });
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
