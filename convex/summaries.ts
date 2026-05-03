import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const setSummaryEmbedding = internalMutation({
  args: {
    summaryId: v.id("summaries"),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.summaryId, { embedding: args.embedding });
  },
});
