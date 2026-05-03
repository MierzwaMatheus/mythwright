import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

const TOGETHER_API_URL = "https://api.together.xyz/v1/embeddings";
const EMBEDDING_MODEL = "BAAI/bge-m3";

export const generateEmbedding = internalAction({
  args: { text: v.string() },
  handler: async (_ctx, args): Promise<number[]> => {
    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) throw new Error("TOGETHER_API_KEY not set");

    const response = await fetch(TOGETHER_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: args.text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Together AI API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data[0].embedding as number[];
  },
});

export const embedFact = internalAction({
  args: { factId: v.id("facts") },
  handler: async (ctx, args) => {
    const factDoc = await ctx.runQuery(internal.embedding._getFactById, { factId: args.factId });
    if (!factDoc) return;

    const embedding = await ctx.runAction(internal.lib.embedding.generateEmbedding, {
      text: factDoc.content,
    });

    await ctx.runMutation(internal.facts.setFactEmbedding, {
      factId: args.factId,
      embedding,
    });
  },
});

export const embedEntity = internalAction({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entityDoc = await ctx.runQuery(internal.embedding._getEntityById, { entityId: args.entityId });
    if (!entityDoc) return;

    const embedding = await ctx.runAction(internal.lib.embedding.generateEmbedding, {
      text: entityDoc.description,
    });

    await ctx.runMutation(internal.entities.setEntityEmbedding, {
      entityId: args.entityId,
      embedding,
    });
  },
});

export const embedTrigger = internalAction({
  args: { triggerId: v.id("triggers") },
  handler: async (ctx, args) => {
    const triggerDoc = await ctx.runQuery(internal.embedding._getTriggerById, { triggerId: args.triggerId });
    if (!triggerDoc) return;

    const embedding = await ctx.runAction(internal.lib.embedding.generateEmbedding, {
      text: triggerDoc.description,
    });

    await ctx.runMutation(internal.triggers.setTriggerEmbedding, {
      triggerId: args.triggerId,
      embedding,
    });
  },
});

export const embedSummary = internalAction({
  args: { summaryId: v.id("summaries") },
  handler: async (ctx, args) => {
    const summaryDoc = await ctx.runQuery(internal.embedding._getSummaryById, { summaryId: args.summaryId });
    if (!summaryDoc) return;

    const embedding = await ctx.runAction(internal.lib.embedding.generateEmbedding, {
      text: summaryDoc.content,
    });

    await ctx.runMutation(internal.summaries.setSummaryEmbedding, {
      summaryId: args.summaryId,
      embedding,
    });
  },
});
