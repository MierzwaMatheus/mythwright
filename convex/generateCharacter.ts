import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import {
  buildCharacterGenerationPrompt,
  parseCharacterGenerationResponse,
} from "./prompts/characterGeneration";

// ── Queries ────────────────────────────────────────────────────────────────────

export const _getCampaign = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.campaignId);
  },
});

// ── Mutations ──────────────────────────────────────────────────────────────────

export const _insertCharacter = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    name: v.string(),
    aspects: v.array(v.string()),
    skills: v.record(v.string(), v.number()),
    stunts: v.array(v.string()),
    fatePoints: v.number(),
    stress: v.object({
      physical: v.array(v.boolean()),
      mental: v.array(v.boolean()),
    }),
  },
  handler: async (ctx, args): Promise<Id<"characters">> => {
    return await ctx.db.insert("characters", {
      campaignId: args.campaignId,
      name: args.name,
      aspects: args.aspects,
      skills: args.skills,
      stunts: args.stunts,
      fatePoints: args.fatePoints,
      stress: args.stress,
      consequences: [],
    });
  },
});

// ── Action ─────────────────────────────────────────────────────────────────────

export const generateCharacter = internalAction({
  args: {
    campaignId: v.id("campaigns"),
    characterPremise: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"characters">> => {
    const campaign = await ctx.runQuery(internal.generateCharacter._getCampaign, {
      campaignId: args.campaignId,
    });

    if (!campaign) throw new Error("Campaign not found");

    const llmConfig = await ctx.runQuery(internal.lib.llmConfig.getLlmConfigInternal, {
      campaignId: args.campaignId,
    });

    const prompt = buildCharacterGenerationPrompt({
      characterPremise: args.characterPremise,
      campaignPremise: campaign.premise,
      campaignTone: campaign.tone,
    });

    const apiKey = process.env.OPENROUTER_API_KEY;
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: llmConfig.narrativeModel,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json();
    const raw = data.choices[0].message.content;
    const charData = parseCharacterGenerationResponse(raw);

    if (!charData) {
      throw new Error(
        "Failed to parse character generation response from LLM — invalid structure or skill pyramid",
      );
    }

    // Flatten aspects: [high_concept, trouble, ...other_aspects]
    const aspects = [charData.high_concept, charData.trouble, ...charData.other_aspects];

    // Flatten stunts: "Name: Description" strings
    const stunts = charData.stunts.map((s) => `${s.name}: ${s.description}`);

    const characterId: Id<"characters"> = await ctx.runMutation(
      internal.generateCharacter._insertCharacter,
      {
        campaignId: args.campaignId,
        name: charData.name,
        aspects,
        skills: charData.skills,
        stunts,
        fatePoints: charData.fate_points,
        stress: charData.stress,
      },
    );

    return characterId;
  },
});
