import { QueryCtx, MutationCtx, internalQuery } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";

export type LlmConfig = {
  narrativeModel: string;
  utilityModel: string;
  extractionModel: string;
  embeddingModel: string;
};

export const DEFAULTS: LlmConfig = {
  narrativeModel: "deepseek/deepseek-chat",
  utilityModel: "meta-llama/llama-3.1-8b-instruct",
  extractionModel: "qwen/qwen-2.5-32b-instruct",
  embeddingModel: "BAAI/bge-m3",
};

export async function getLlmConfig(
  ctx: QueryCtx | MutationCtx,
  campaignId: Id<"campaigns">,
): Promise<LlmConfig> {
  const campaign = await ctx.db.get(campaignId);
  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found`);
  }
  return { ...DEFAULTS, ...campaign.llmConfig };
}

export const getLlmConfigInternal = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args): Promise<LlmConfig> => {
    return getLlmConfig(ctx, args.campaignId);
  },
});
