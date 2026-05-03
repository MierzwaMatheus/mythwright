import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { rollFateDice, calculateOutcome, FateOutcome } from "../../packages/fate-engine/src/index";

/**
 * Wrapper interno que chama rollFateDice do fate-engine e persiste o resultado em diceRolls.
 * Usado pelo loop de tool calling em processTurn como implementação da tool "roll_fate_dice".
 */
export const rollFateDiceInternal = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    messageId: v.id("messages"),
    skillName: v.string(),
    skillLevel: v.number(),
    type: v.union(
      v.literal("attack"),
      v.literal("defend"),
      v.literal("overcome"),
      v.literal("create_advantage")
    ),
    description: v.string(),
    seed: v.string(),
    opposition: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    rollId: Id<"diceRolls">;
    diceResults: number[];
    diceTotal: number;
    finalResult: number;
    outcome?: FateOutcome;
  }> => {
    // Chamar o fate-engine (puro, determinístico)
    const rollResult = rollFateDice(args.seed, args.skillLevel);

    const diceResults = [...rollResult.dice] as number[];
    const finalResult = rollResult.total;
    const diceTotal = rollResult.total; // total já inclui skillLevel no fate-engine

    // Calcular outcome se opposition for fornecida
    let outcome: FateOutcome | undefined;
    if (args.opposition !== undefined) {
      outcome = calculateOutcome(finalResult, args.opposition);
    }

    // Persistir em diceRolls
    const rollId = await ctx.db.insert("diceRolls", {
      campaignId: args.campaignId,
      messageId: args.messageId,
      type: args.type,
      skillName: args.skillName,
      skillLevel: args.skillLevel,
      invokedAspectIds: [],
      bonus: 0,
      diceResults,
      diceTotal,
      finalResult,
      description: args.description,
      ...(args.opposition !== undefined ? { opposition: args.opposition } : {}),
      ...(outcome !== undefined ? { outcome } : {}),
      seed: args.seed,
      rolledAt: Date.now(),
    });

    return {
      rollId,
      diceResults,
      diceTotal,
      finalResult,
      ...(outcome !== undefined ? { outcome } : {}),
    };
  },
});
