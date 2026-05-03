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
  }).index("by_campaign", ["campaignId"])
    .index("by_campaign_created", ["campaignId", "createdAt"]),

  messages: defineTable({
    campaignId: v.id("campaigns"),
  }).index("by_campaign", ["campaignId"]),

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
    visibility: v.union(v.literal("hidden"), v.literal("known")),
    description: v.string(),
  }).index("by_campaign", ["campaignId"])
    .index("by_campaign_and_visibility", ["campaignId", "visibility"])
    .index("by_campaign_and_type", ["campaignId", "type"]),

  facts: defineTable({
    campaignId: v.id("campaigns"),
    content: v.string(),
    visibility: v.union(v.literal("hidden"), v.literal("rumored"), v.literal("known")),
    relatedEntityIds: v.optional(v.array(v.id("entities"))),
  }).index("by_campaign", ["campaignId"])
    .index("by_campaign_and_visibility", ["campaignId", "visibility"]),

  triggers: defineTable({
    campaignId: v.id("campaigns"),
    description: v.string(),
    scope: v.string(),
    effects: v.array(v.object({ type: v.string(), payload: v.any() })),
    status: v.union(v.literal("armed"), v.literal("disabled"), v.literal("fired")),
    firedAt: v.optional(v.number()),
  }).index("by_campaign", ["campaignId"]),

  summaries: defineTable({
    campaignId: v.id("campaigns"),
  }).index("by_campaign", ["campaignId"]),

  diceRolls: defineTable({
    campaignId: v.id("campaigns"),
  }).index("by_campaign", ["campaignId"]),

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
});
