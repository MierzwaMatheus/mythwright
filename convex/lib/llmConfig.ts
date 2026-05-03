import { QueryCtx, MutationCtx, internalQuery } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";

export type LlmConfig = {
  narrativeModel: string;
  utilityModel: string;
  extractionModel: string;
  embeddingModel: string;
};

const DEFAULT_LLM_CONFIG: LlmConfig = {
  narrativeModel: "deepseek/deepseek-chat-v3-0324",
  utilityModel: "meta-llama/llama-3.1-8b-instruct",
  extractionModel: "meta-llama/llama-3.1-8b-instruct",
  embeddingModel: "baai/bge-m3",
};

export async function getLlmConfig(
  ctx: QueryCtx | MutationCtx,
  campaignId: Id<"campaigns">,
): Promise<LlmConfig> {
  const campaign = await ctx.db.get(campaignId);
  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found`);
  }
  if (!campaign.llmConfig) {
    return { ...DEFAULT_LLM_CONFIG };
  }
  return { ...campaign.llmConfig };
}

export const getLlmConfigInternal = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args): Promise<LlmConfig> => {
    return getLlmConfig(ctx, args.campaignId);
  },
});
