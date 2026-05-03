import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";

const CONSEQUENCE_ABSORBED: Record<"mild" | "moderate" | "severe", number> = {
  mild: 2,
  moderate: 4,
  severe: 6,
};

export const applyStress = mutation({
  args: {
    characterId: v.id("characters"),
    track: v.union(v.literal("physical"), v.literal("mental")),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    const character = await ctx.db.get(args.characterId);
    if (!character) throw new ConvexError("Character not found");

    const campaign = await ctx.db.get(character.campaignId);
    if (!campaign) throw new ConvexError("Campaign not found");
    if (campaign.userId !== user._id) throw new ConvexError("Unauthorized");

    const stressTrack = [...character.stress[args.track]];
    const exactIndex = args.amount - 1;

    // 1. Caixa exata disponível
    if (exactIndex < stressTrack.length && stressTrack[exactIndex] === false) {
      stressTrack[exactIndex] = true;
      await ctx.db.patch(args.characterId, {
        stress: { ...character.stress, [args.track]: stressTrack },
      });
      return { needsConsequence: false };
    }

    // 2. Menor caixa disponível com índice > exactIndex
    const fallbackIndex = stressTrack.findIndex(
      (box, i) => i > exactIndex && box === false,
    );
    if (fallbackIndex !== -1) {
      stressTrack[fallbackIndex] = true;
      await ctx.db.patch(args.characterId, {
        stress: { ...character.stress, [args.track]: stressTrack },
      });
      return { needsConsequence: false };
    }

    // 3. Nenhuma caixa disponível
    return { needsConsequence: true, overflow: args.amount };
  },
});

export const applyConsequence = mutation({
  args: {
    characterId: v.id("characters"),
    severity: v.union(v.literal("mild"), v.literal("moderate"), v.literal("severe")),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    const character = await ctx.db.get(args.characterId);
    if (!character) throw new ConvexError("Character not found");

    const campaign = await ctx.db.get(character.campaignId);
    if (!campaign) throw new ConvexError("Campaign not found");
    if (campaign.userId !== user._id) throw new ConvexError("Unauthorized");

    const alreadyExists = character.consequences.some((c) => c.severity === args.severity);
    if (alreadyExists) {
      throw new ConvexError(
        `Já existe uma consequência de severidade "${args.severity}" para este personagem.`,
      );
    }

    await ctx.db.patch(args.characterId, {
      consequences: [...character.consequences, { severity: args.severity, description: args.description }],
    });

    return { absorbed: CONSEQUENCE_ABSORBED[args.severity] };
  },
});
