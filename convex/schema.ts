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
  }).index("by_user", ["userId"])
    .index("by_user_activity", ["userId", "lastActivityAt"]),
});
