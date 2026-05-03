import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const _getFactById = internalQuery({
  args: { factId: v.id("facts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.factId);
  },
});

export const _getEntityById = internalQuery({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.entityId);
  },
});

export const _getTriggerById = internalQuery({
  args: { triggerId: v.id("triggers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.triggerId);
  },
});

export const _getSummaryById = internalQuery({
  args: { summaryId: v.id("summaries") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.summaryId);
  },
});
