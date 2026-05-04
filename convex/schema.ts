import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    email: v.string(),
    displayName: v.string(),
    avatar: v.optional(v.string()),
    tokenIdentifier: v.string(),
    encryptedOpenRouterKey: v.optional(v.string()),
  }).index("by_token", ["tokenIdentifier"]),

  campaigns: defineTable({
    userId: v.id("users"),
    name: v.string(),
    premise: v.string(),
    tone: v.string(),
    expectedDuration: v.union(v.literal("one-shot"), v.literal("medium"), v.literal("long")),
    status: v.union(
      v.literal("setup"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("archived"),
    ),
    createdAt: v.number(),
    lastActivityAt: v.number(),
    cheatModeEnabled: v.optional(v.boolean()),
    antiLeakValidationEnabled: v.optional(v.boolean()),
    llmConfig: v.optional(v.object({
      narrativeModel: v.optional(v.string()),
      utilityModel: v.optional(v.string()),
      extractionModel: v.optional(v.string()),
      embeddingModel: v.optional(v.string()),
    })),
    currentSceneId: v.optional(v.id("scenes")),
  }).index("by_user", ["userId"])
    .index("by_user_activity", ["userId", "lastActivityAt"]),

  characters: defineTable({
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
    consequences: v.array(v.object({
      severity: v.union(v.literal("mild"), v.literal("moderate"), v.literal("severe")),
      description: v.string(),
    })),
  }).index("by_campaign", ["campaignId"]),

  scenes: defineTable({
    campaignId: v.id("campaigns"),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal("inactive"), v.literal("active"), v.literal("completed")),
    createdAt: v.number(),
    endedAt: v.optional(v.number()),
    locationId: v.optional(v.id("entities")),
    presentEntityIds: v.optional(v.array(v.id("entities"))),
  }).index("by_campaign", ["campaignId"])
    .index("by_campaign_created", ["campaignId", "createdAt"]),

  messages: defineTable({
    campaignId: v.id("campaigns"),
    sceneId: v.optional(v.id("scenes")),
    role: v.union(v.literal("player"), v.literal("gm"), v.literal("system")),
    content: v.string(),
    clientMessageId: v.string(),
    status: v.union(v.literal("pending"), v.literal("complete"), v.literal("failed"), v.literal("leaked")),
    createdAt: v.optional(v.number()),
    finalizedAt: v.optional(v.number()),
    toolCalls: v.optional(v.array(v.object({
      toolName: v.string(),
      toolParams: v.any(),
      toolResult: v.any(),
      executedAt: v.number(),
    }))),
    embedding: v.optional(v.array(v.float64())),
    causedByMessageId: v.optional(v.id("messages")),
    triggersFired: v.optional(v.array(v.id("triggers"))),
    factsRevealed: v.optional(v.array(v.id("facts"))),
    tokensUsed: v.optional(v.object({ input: v.number(), output: v.number() })),
    promptVersion: v.optional(v.string()),
  }).index("by_campaign", ["campaignId"])
    .index("by_campaign_and_clientMessageId", ["campaignId", "clientMessageId"])
    .index("by_scene_and_createdAt", ["sceneId", "createdAt"])
    .index("by_caused_by", ["causedByMessageId"])
    .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 1024, filterFields: ["campaignId", "sceneId"] }),

  entities: defineTable({
    campaignId: v.id("campaigns"),
    type: v.union(
      v.literal("npc"),
      v.literal("location"),
      v.literal("faction"),
      v.literal("item"),
      v.literal("concept"),
    ),
    name: v.string(),
    visibility: v.union(v.literal("hidden"), v.literal("rumored"), v.literal("known")),
    description: v.string(),
    embedding: v.optional(v.array(v.float64())),
    npcStats: v.optional(v.any()),
    relations: v.optional(v.array(v.any())),
  }).index("by_campaign", ["campaignId"])
    .index("by_campaign_and_visibility", ["campaignId", "visibility"])
    .index("by_campaign_and_type", ["campaignId", "type"])
    .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 1024, filterFields: ["campaignId", "type", "visibility"] }),

  facts: defineTable({
    campaignId: v.id("campaigns"),
    content: v.string(),
    visibility: v.union(v.literal("hidden"), v.literal("rumored"), v.literal("known")),
    relatedEntityIds: v.optional(v.array(v.id("entities"))),
    revealedBy: v.optional(v.object({
      messageId: v.id("messages"),
      triggerId: v.optional(v.id("triggers")),
      revealedAt: v.number(),
    })),
    category: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.optional(v.number()),
  }).index("by_campaign", ["campaignId"])
    .index("by_campaign_and_visibility", ["campaignId", "visibility"])
    .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 1024, filterFields: ["campaignId", "visibility"] }),

  triggers: defineTable({
    campaignId: v.id("campaigns"),
    description: v.string(),
    scope: v.union(v.literal("global"), v.literal("scene"), v.literal("location")),
    effects: v.array(v.object({ type: v.string(), payload: v.any() })),
    status: v.union(v.literal("armed"), v.literal("disabled"), v.literal("fired")),
    firedAt: v.optional(v.number()),
    scopeRefId: v.optional(v.string()),
    oneShot: v.boolean(),
    firedByMessageId: v.optional(v.id("messages")),
    embedding: v.optional(v.array(v.float64())),
  }).index("by_campaign", ["campaignId"])
    .index("by_campaign_status_scope", ["campaignId", "status", "scope"])
    .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 1024, filterFields: ["campaignId", "status", "scope"] }),

  summaries: defineTable({
    campaignId: v.id("campaigns"),
    level: v.union(v.literal("scene"), v.literal("arc"), v.literal("campaign")),
    content: v.string(),
    sourceMessageIds: v.optional(v.array(v.id("messages"))),
    sourceSceneIds: v.optional(v.array(v.id("scenes"))),
    sourceSummaryIds: v.optional(v.array(v.id("summaries"))),
    coversFrom: v.number(),
    coversTo: v.number(),
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
  }).index("by_campaign", ["campaignId"])
    .index("by_campaign_level", ["campaignId", "level"])
    .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 1024, filterFields: ["campaignId", "level"] }),

  diceRolls: defineTable({
    campaignId: v.id("campaigns"),
    messageId: v.id("messages"),
    type: v.union(v.literal("attack"), v.literal("defend"), v.literal("overcome"), v.literal("create_advantage")),
    skillName: v.string(),
    skillLevel: v.number(),
    invokedAspectIds: v.array(v.id("sceneAspects")),
    bonus: v.number(),
    diceResults: v.array(v.number()),
    diceTotal: v.number(),
    finalResult: v.number(),
    description: v.string(),
    opposition: v.optional(v.number()),
    outcome: v.optional(v.union(v.literal("failure"), v.literal("tie"), v.literal("success"), v.literal("success_with_style"))),
    seed: v.string(),
    rolledAt: v.number(),
  }).index("by_campaign", ["campaignId"])
    .index("by_message", ["messageId"]),

  characterEditLogs: defineTable({
    characterId: v.id("characters"),
    field: v.string(),
    oldValue: v.any(),
    newValue: v.any(),
    timestamp: v.number(),
    messageId: v.optional(v.id("messages")),
    reason: v.optional(v.string()),
  }).index("by_character", ["characterId"]),

  sceneAspects: defineTable({
    sceneId: v.id("scenes"),
    text: v.string(),
    freeInvokes: v.number(),
  }).index("by_scene", ["sceneId"]),

  aspectInvocations: defineTable({
    aspectId: v.id("sceneAspects"),
    targetRollId: v.id("diceRolls"),
    effect: v.union(v.literal("bonus_2"), v.literal("reroll")),
    payerId: v.id("characters"),
    usesFreeInvoke: v.boolean(),
    invokedAt: v.number(),
  }).index("by_aspect", ["aspectId"]),

  compels: defineTable({
    campaignId: v.id("campaigns"),
    aspectId: v.id("sceneAspects"),
    characterId: v.id("characters"),
    complication: v.string(),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("refused")),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
    triggeringMessageId: v.optional(v.id("messages")),
    pausedGmMessageId: v.optional(v.id("messages")),
  }).index("by_campaign", ["campaignId"])
    .index("by_character", ["characterId"]),
});
