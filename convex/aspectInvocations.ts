import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { api } from "./_generated/api";
import { getAuthenticatedUser } from "./lib/auth";

export const invokeAspect = mutation({
  args: {
    aspectId: v.id("sceneAspects"),
    targetRollId: v.id("diceRolls"),
    effect: v.union(v.literal("bonus_2"), v.literal("reroll")),
    payerId: v.id("characters"),
    usesFreeInvoke: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    if (args.usesFreeInvoke) {
      const aspect = await ctx.db.get(args.aspectId);
      if (!aspect) throw new ConvexError("Aspect not found");
      if (aspect.freeInvokes === 0) {
        throw new ConvexError("No free invokes remaining");
      }
      await ctx.db.patch(args.aspectId, { freeInvokes: aspect.freeInvokes - 1 });
    } else {
      await ctx.runMutation(api.characters.spendFatePoint, {
        characterId: args.payerId,
        reason: "Invocação de aspecto",
      });
    }

    return await ctx.db.insert("aspectInvocations", {
      aspectId: args.aspectId,
      targetRollId: args.targetRollId,
      effect: args.effect,
      payerId: args.payerId,
      usesFreeInvoke: args.usesFreeInvoke,
      invokedAt: Date.now(),
    });
  },
});
