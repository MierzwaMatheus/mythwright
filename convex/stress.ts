import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";

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
