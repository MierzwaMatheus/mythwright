import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

// Provedor: Together AI — escolhido por consistência com o restante do stack e
// custo reduzido para embeddings. O modelo padrão é BAAI/bge-m3 (1024 dims).
const TOGETHER_API_URL = "https://api.together.xyz/v1/embeddings";
const EMBEDDING_MODEL = "BAAI/bge-m3";
const EXPECTED_EMBEDDING_DIMENSION = 1024;

export const generateEmbedding = internalAction({
  args: { text: v.string(), model: v.optional(v.string()) },
  handler: async (_ctx, args): Promise<number[]> => {
    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) throw new Error("TOGETHER_API_KEY not set");

    const model = args.model ?? EMBEDDING_MODEL;

    const response = await fetch(TOGETHER_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: args.text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Together AI API error: ${response.status}`);
    }

    const data = await response.json();
    const embedding = data.data[0].embedding as number[];

    if (embedding.length !== EXPECTED_EMBEDDING_DIMENSION) {
      throw new Error(
        `Embedding dimension mismatch: expected ${EXPECTED_EMBEDDING_DIMENSION}, got ${embedding.length}`,
      );
    }

    return embedding;
  },
});

export const embedFact = internalAction({
  args: { factId: v.id("facts") },
  handler: async (ctx, args) => {
    const factDoc = await ctx.runQuery(internal.embedding._getFactById, { factId: args.factId });
    if (!factDoc) return;

    const llmConfig = await ctx.runQuery(internal.lib.llmConfig.getLlmConfigInternal, {
      campaignId: factDoc.campaignId,
    });

    const embedding = await ctx.runAction(internal.lib.embedding.generateEmbedding, {
      text: factDoc.content,
      model: llmConfig.embeddingModel,
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

    const llmConfig = await ctx.runQuery(internal.lib.llmConfig.getLlmConfigInternal, {
      campaignId: entityDoc.campaignId,
    });

    const embedding = await ctx.runAction(internal.lib.embedding.generateEmbedding, {
      text: entityDoc.description,
      model: llmConfig.embeddingModel,
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

    const llmConfig = await ctx.runQuery(internal.lib.llmConfig.getLlmConfigInternal, {
      campaignId: triggerDoc.campaignId,
    });

    const embedding = await ctx.runAction(internal.lib.embedding.generateEmbedding, {
      text: triggerDoc.description,
      model: llmConfig.embeddingModel,
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

    const llmConfig = await ctx.runQuery(internal.lib.llmConfig.getLlmConfigInternal, {
      campaignId: summaryDoc.campaignId,
    });

    const embedding = await ctx.runAction(internal.lib.embedding.generateEmbedding, {
      text: summaryDoc.content,
      model: llmConfig.embeddingModel,
    });

    await ctx.runMutation(internal.summaries.setSummaryEmbedding, {
      summaryId: args.summaryId,
      embedding,
    });
  },
});

export const embedMessage = internalAction({
  args: { messageId: v.id("messages"), content: v.string() },
  handler: async (ctx, args) => {
    const messageDoc = await ctx.runQuery(internal.embedding._getMessageById, { messageId: args.messageId });
    if (!messageDoc) return;

    const llmConfig = await ctx.runQuery(internal.lib.llmConfig.getLlmConfigInternal, {
      campaignId: messageDoc.campaignId,
    });

    const embedding = await ctx.runAction(internal.lib.embedding.generateEmbedding, {
      text: args.content,
      model: llmConfig.embeddingModel,
    });

    await ctx.runMutation(internal.messages.setEmbeddingInternal, {
      messageId: args.messageId,
      embedding,
    });
  },
});
