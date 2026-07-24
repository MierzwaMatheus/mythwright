import { ConvexError, v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";

async function assertOwner(
  ctx: { auth: { getUserIdentity(): Promise<{ tokenIdentifier: string } | null> }; runQuery: Function },
  campaignId: Id<"campaigns">,
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Not authenticated");
  return await ctx.runQuery(internal.campaigns.validateOwnership, {
    campaignId,
    tokenIdentifier: identity.tokenIdentifier,
  });
}

export const submitTurn = action({
  args: {
    campaignId: v.id("campaigns"),
    playerMessageId: v.id("messages"),
    antiLeakValidationEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await assertOwner(ctx, args.campaignId);
    return await ctx.runAction(internal.processTurn.processTurnFull, {
      campaignId: args.campaignId,
      playerMessageId: args.playerMessageId,
      antiLeakValidationEnabled: args.antiLeakValidationEnabled,
    });
  },
});

export const requestWorldGeneration = action({
  args: {
    campaignId: v.id("campaigns"),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertOwner(ctx, args.campaignId);
    await ctx.runAction(internal.generateWorld.generateWorld, {
      campaignId: args.campaignId,
      apiKey: args.apiKey,
    });
  },
});

export const requestCharacterGeneration = action({
  args: {
    campaignId: v.id("campaigns"),
    characterPremise: v.string(),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"characters">> => {
    await assertOwner(ctx, args.campaignId);
    return await ctx.runAction(internal.generateCharacter.generateCharacter, {
      campaignId: args.campaignId,
      characterPremise: args.characterPremise,
      apiKey: args.apiKey,
    });
  },
});
