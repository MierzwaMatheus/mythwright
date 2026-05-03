import { ConvexError, v } from "convex/values";
import { mutation, MutationCtx } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";
import { Id } from "./_generated/dataModel";

async function assertCampaignOwnership(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  userId: Id<"users">,
) {
  const campaign = await ctx.db.get(campaignId);
  if (!campaign) throw new ConvexError("Campaign not found");
  if (campaign.userId !== userId) throw new ConvexError("Unauthorized");
  return campaign;
}

export const createCharacter = mutation({
  args: {
    campaignId: v.id("campaigns"),
    name: v.string(),
    aspects: v.array(v.string()),
    skills: v.record(v.string(), v.number()),
    stunts: v.array(v.string()),
    fatePoints: v.optional(v.number()),
    stress: v.object({
      physical: v.array(v.boolean()),
      mental: v.array(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    if (args.aspects.length > 5) {
      throw new ConvexError("aspects cannot have more than 5 entries");
    }

    await assertCampaignOwnership(ctx, args.campaignId, user._id);

    return await ctx.db.insert("characters", {
      campaignId: args.campaignId,
      name: args.name,
      aspects: args.aspects,
      skills: args.skills,
      stunts: args.stunts,
      fatePoints: args.fatePoints ?? 3,
      stress: args.stress,
      consequences: [],
    });
  },
});

export const awardFatePoint = mutation({
  args: {
    characterId: v.id("characters"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");
    const character = await ctx.db.get(args.characterId);
    if (!character) throw new ConvexError("Personagem não encontrado");
    await assertCampaignOwnership(ctx, character.campaignId, user._id);

    const oldValue = character.fatePoints;
    const newValue = oldValue + 1;

    await ctx.db.patch(args.characterId, { fatePoints: newValue });

    await ctx.db.insert("characterEditLogs", {
      characterId: args.characterId,
      field: "fatePoints",
      oldValue,
      newValue,
      timestamp: Date.now(),
      reason: args.reason,
    });
  },
});

export const spendFatePoint = mutation({
  args: {
    characterId: v.id("characters"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");
    const character = await ctx.db.get(args.characterId);
    if (!character) throw new ConvexError("Personagem não encontrado");
    await assertCampaignOwnership(ctx, character.campaignId, user._id);

    if (character.fatePoints === 0) {
      throw new ConvexError("Sem pontos de destino disponíveis");
    }

    const oldValue = character.fatePoints;
    const newValue = oldValue - 1;

    await ctx.db.patch(args.characterId, { fatePoints: newValue });

    await ctx.db.insert("characterEditLogs", {
      characterId: args.characterId,
      field: "fatePoints",
      oldValue,
      newValue,
      timestamp: Date.now(),
      reason: args.reason,
    });
  },
});

export const updateCharacterField = mutation({
  args: {
    characterId: v.id("characters"),
    field: v.string(),
    value: v.any(),
    messageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    const character = await ctx.db.get(args.characterId);
    if (!character) throw new ConvexError("Character not found");

    await assertCampaignOwnership(ctx, character.campaignId, user._id);

    const oldValue = (character as Record<string, unknown>)[args.field];

    await ctx.db.patch(args.characterId, { [args.field]: args.value });

    await ctx.db.insert("characterEditLogs", {
      characterId: args.characterId,
      field: args.field,
      oldValue,
      newValue: args.value,
      timestamp: Date.now(),
      messageId: args.messageId,
    });
  },
});
