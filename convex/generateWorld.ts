import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import {
  buildWorldGenerationPrompt,
  parseWorldGenerationResponse,
  WorldGenerationOutput,
} from "./prompts/worldGeneration";

// ── Queries ────────────────────────────────────────────────────────────────────

export const _getCampaign = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.campaignId);
  },
});

// ── Mutations ──────────────────────────────────────────────────────────────────

export const _persistWorld = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    worldData: v.any(),
  },
  handler: async (ctx, args): Promise<{
    entityIds: Id<"entities">[];
    factIds: Id<"facts">[];
    triggerIds: Id<"triggers">[];
    sceneId: Id<"scenes">;
  }> => {
    const world = args.worldData as WorldGenerationOutput;
    const now = Date.now();
    const nameToEntityId = new Map<string, Id<"entities">>();

    // 1. Persist starting location
    const locationId = await ctx.db.insert("entities", {
      campaignId: args.campaignId,
      type: "location",
      name: world.starting_location.name,
      description: world.starting_location.description,
      visibility: "known",
      npcStats: { aspects: world.starting_location.aspects },
    });
    nameToEntityId.set(world.starting_location.name, locationId);
    const entityIds: Id<"entities">[] = [locationId];

    // 2. Persist NPCs
    for (const npc of world.npcs) {
      const id = await ctx.db.insert("entities", {
        campaignId: args.campaignId,
        type: "npc",
        name: npc.name,
        description: npc.description,
        visibility: npc.visibility,
        npcStats: {
          tier: npc.tier,
          hidden_motivation: npc.hidden_motivation,
        },
      });
      nameToEntityId.set(npc.name, id);
      entityIds.push(id);
    }

    // 3. Persist factions
    for (const faction of world.factions) {
      const id = await ctx.db.insert("entities", {
        campaignId: args.campaignId,
        type: "faction",
        name: faction.name,
        description: faction.description,
        visibility: faction.visibility,
        npcStats: { agenda: faction.agenda },
      });
      nameToEntityId.set(faction.name, id);
      entityIds.push(id);
    }

    // 4. Persist facts (resolving entity references)
    const factIds: Id<"facts">[] = [];
    for (const fact of world.facts) {
      const relatedEntityIds = (fact.related_entity_names ?? [])
        .map((name) => nameToEntityId.get(name))
        .filter((id): id is Id<"entities"> => id !== undefined);

      const id = await ctx.db.insert("facts", {
        campaignId: args.campaignId,
        content: fact.content,
        visibility: fact.visibility,
        category: fact.category,
        relatedEntityIds,
        createdAt: now,
      });
      factIds.push(id);
    }

    // 5. Persist triggers
    const triggerIds: Id<"triggers">[] = [];
    for (const trigger of world.triggers) {
      const effects = trigger.effects.map((e) => ({
        type: e.type,
        payload: { target_description: e.target_description },
      }));

      const id = await ctx.db.insert("triggers", {
        campaignId: args.campaignId,
        description: trigger.description,
        scope: trigger.scope,
        scopeRefId: trigger.scope_target_name ?? undefined,
        effects,
        status: "armed",
        oneShot: trigger.one_shot,
      });
      triggerIds.push(id);
    }

    // 6. Persist starting scene
    const presentEntityIds = world.starting_scene.present_npc_names
      .map((name) => nameToEntityId.get(name))
      .filter((id): id is Id<"entities"> => id !== undefined);

    const sceneId = await ctx.db.insert("scenes", {
      campaignId: args.campaignId,
      title: world.starting_scene.title,
      description: world.starting_scene.description,
      status: "active",
      locationId,
      presentEntityIds,
      createdAt: now,
    });

    // 7. Update campaign: set currentSceneId and status to active
    await ctx.db.patch(args.campaignId, {
      currentSceneId: sceneId,
      status: "active",
      lastActivityAt: now,
    });

    return { entityIds, factIds, triggerIds, sceneId };
  },
});

// ── Action ─────────────────────────────────────────────────────────────────────

export const generateWorld = internalAction({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args): Promise<void> => {
    const campaign = await ctx.runQuery(internal.generateWorld._getCampaign, {
      campaignId: args.campaignId,
    });

    if (!campaign) throw new Error("Campaign not found");

    const llmConfig = await ctx.runQuery(internal.lib.llmConfig.getLlmConfigInternal, {
      campaignId: args.campaignId,
    });

    const prompt = buildWorldGenerationPrompt({
      campaignName: campaign.name,
      premise: campaign.premise,
      tone: campaign.tone,
      expectedDuration: campaign.expectedDuration,
      freeDescription: "",
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
    const worldData = parseWorldGenerationResponse(raw);

    if (!worldData) {
      throw new Error("Failed to parse world generation response from LLM");
    }

    // Persist all data in a single mutation (atomic)
    const { entityIds, factIds, triggerIds } = await ctx.runMutation(
      internal.generateWorld._persistWorld,
      { campaignId: args.campaignId, worldData },
    );

    // Schedule embeddings for all created objects (best-effort, after commit)
    for (const entityId of entityIds) {
      await ctx.scheduler.runAfter(0, internal.lib.embedding.embedEntity, { entityId });
    }
    for (const factId of factIds) {
      await ctx.scheduler.runAfter(0, internal.lib.embedding.embedFact, { factId });
    }
    for (const triggerId of triggerIds) {
      await ctx.scheduler.runAfter(0, internal.lib.embedding.embedTrigger, { triggerId });
    }
  },
});
