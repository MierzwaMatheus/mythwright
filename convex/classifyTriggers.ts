import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  buildTriggerClassifierPrompt,
  parseTriggerClassifierResponse,
  TriggerCandidate,
} from "./prompts/triggerClassifier";

export const classifyTriggers = internalAction({
  args: {
    campaignId: v.id("campaigns"),
    playerMessage: v.string(),
    sceneSummary: v.string(),
    candidates: v.array(
      v.object({
        id: v.string(),
        description: v.string(),
        scope: v.string(),
      }),
    ),
    apiKey: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ activatedIds: string[] }> => {
    const llmConfig = await ctx.runQuery(
      internal.lib.llmConfig.getLlmConfigInternal,
      { campaignId: args.campaignId },
    );

    const candidates: TriggerCandidate[] = args.candidates;
    const prompt = buildTriggerClassifierPrompt(
      args.playerMessage,
      args.sceneSummary,
      candidates,
    );

    const apiKey = args.apiKey ?? process.env.OPENROUTER_API_KEY;
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: llmConfig.utilityModel,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
        }),
      },
    );

    const data = await response.json();
    const raw = data.choices[0].message.content;
    const parsed = parseTriggerClassifierResponse(raw);

    return { activatedIds: parsed.ativados };
  },
});
