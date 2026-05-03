import { ConvexError, v } from "convex/values";
import { mutation, MutationCtx } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";
import { Id } from "./_generated/dataModel";

async function assertCharacterOwnership(
  ctx: MutationCtx,
  characterId: Id<"characters">,
  userId: Id<"users">,
) {
  const character = await ctx.db.get(characterId);
  if (!character) throw new ConvexError("Character not found");

  const campaign = await ctx.db.get(character.campaignId);
  if (!campaign) throw new ConvexError("Campaign not found");
  if (campaign.userId !== userId) throw new ConvexError("Unauthorized");

  return character;
}

const severityValidator = v.union(
  v.literal("mild"),
  v.literal("moderate"),
  v.literal("severe"),
);

export const addConsequence = mutation({
  args: {
    characterId: v.id("characters"),
    severity: severityValidator,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    const character = await assertCharacterOwnership(ctx, args.characterId, user._id);

    const alreadyExists = character.consequences.some(
      (c) => c.severity === args.severity,
    );
    if (alreadyExists) {
      throw new ConvexError(
        `Consequência de severidade "${args.severity}" já existe para este personagem`,
      );
    }

    const updated = [
      ...character.consequences,
      { severity: args.severity, description: args.description },
    ];

    await ctx.db.patch(args.characterId, { consequences: updated });
  },
});

export const clearConsequence = mutation({
  args: {
    characterId: v.id("characters"),
    severity: severityValidator,
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    const character = await assertCharacterOwnership(ctx, args.characterId, user._id);

    const exists = character.consequences.some((c) => c.severity === args.severity);
    if (!exists) {
      throw new ConvexError(
        `Consequência de severidade "${args.severity}" não encontrada`,
      );
    }

    const updated = character.consequences.filter((c) => c.severity !== args.severity);
    await ctx.db.patch(args.characterId, { consequences: updated });
  },
});
