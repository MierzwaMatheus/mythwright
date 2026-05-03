import { ConvexError, v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";

/**
 * Contexto de execução passado para cada tool.
 * Contém IDs necessários para persistência e rastreabilidade.
 */
type ToolExecutionContext = {
  campaignId: Id<"campaigns">;
  messageId: Id<"messages">;
  sceneId: Id<"scenes">;
};

// ─── Implementações individuais das tools ────────────────────────────────────

async function execAwardFatePoint(
  ctx: MutationCtx,
  params: { characterId: Id<"characters">; reason: string },
  _context: ToolExecutionContext
) {
  const character = await ctx.db.get(params.characterId);
  if (!character) throw new ConvexError("Character not found");

  await ctx.db.patch(params.characterId, { fatePoints: character.fatePoints + 1 });

  return { fatePoints: character.fatePoints + 1, reason: params.reason };
}

async function execSpendFatePoint(
  ctx: MutationCtx,
  params: { characterId: Id<"characters">; reason: string },
  _context: ToolExecutionContext
) {
  const character = await ctx.db.get(params.characterId);
  if (!character) throw new ConvexError("Character not found");

  if (character.fatePoints <= 0) {
    throw new ConvexError("Personagem não tem Pontos de Destino suficientes");
  }

  await ctx.db.patch(params.characterId, { fatePoints: character.fatePoints - 1 });

  return { fatePoints: character.fatePoints - 1, reason: params.reason };
}

async function execApplyStress(
  ctx: MutationCtx,
  params: { characterId: Id<"characters">; amount: number; track: "physical" | "mental" },
  _context: ToolExecutionContext
) {
  const character = await ctx.db.get(params.characterId);
  if (!character) throw new ConvexError("Character not found");

  const stressTrack = [...character.stress[params.track]];
  const exactIndex = params.amount - 1;

  // 1. Caixa exata disponível
  if (exactIndex >= 0 && exactIndex < stressTrack.length && stressTrack[exactIndex] === false) {
    stressTrack[exactIndex] = true;
    await ctx.db.patch(params.characterId, {
      stress: { ...character.stress, [params.track]: stressTrack },
    });
    return { absorbed: true, needsConsequence: false };
  }

  // 2. Menor caixa disponível com índice > exactIndex
  const fallbackIndex = stressTrack.findIndex((box, i) => i > exactIndex && box === false);
  if (fallbackIndex !== -1) {
    stressTrack[fallbackIndex] = true;
    await ctx.db.patch(params.characterId, {
      stress: { ...character.stress, [params.track]: stressTrack },
    });
    return { absorbed: true, needsConsequence: false };
  }

  // 3. Nenhuma caixa disponível — precisa de consequência
  return { absorbed: false, needsConsequence: true, overflow: params.amount };
}

async function execApplyConsequence(
  ctx: MutationCtx,
  params: { characterId: Id<"characters">; severity: "mild" | "moderate" | "severe"; description: string },
  _context: ToolExecutionContext
) {
  const character = await ctx.db.get(params.characterId);
  if (!character) throw new ConvexError("Character not found");

  const alreadyExists = character.consequences.some((c) => c.severity === params.severity);
  if (alreadyExists) {
    throw new ConvexError(`Já existe uma consequência de severidade "${params.severity}" para este personagem.`);
  }

  await ctx.db.patch(params.characterId, {
    consequences: [...character.consequences, { severity: params.severity, description: params.description }],
  });

  const absorbed = { mild: 2, moderate: 4, severe: 6 }[params.severity];
  return { absorbed, severity: params.severity, description: params.description };
}

async function execAddSceneAspect(
  ctx: MutationCtx,
  params: { sceneId: Id<"scenes">; text: string; freeInvokes?: number },
  _context: ToolExecutionContext
) {
  const scene = await ctx.db.get(params.sceneId);
  if (!scene) throw new ConvexError("Scene not found");

  const aspectId = await ctx.db.insert("sceneAspects", {
    sceneId: params.sceneId,
    text: params.text,
    freeInvokes: params.freeInvokes ?? 0,
  });

  return { aspectId, text: params.text };
}

async function execRevealFact(
  ctx: MutationCtx,
  params: { factId: Id<"facts"> },
  context: ToolExecutionContext
) {
  const fact = await ctx.db.get(params.factId);
  if (!fact) throw new ConvexError("Fact not found");

  await ctx.db.patch(params.factId, {
    visibility: "known",
    revealedBy: {
      messageId: context.messageId,
      revealedAt: Date.now(),
    },
  });

  return { factId: params.factId, content: fact.content };
}

async function execRevealEntity(
  ctx: MutationCtx,
  params: { entityId: Id<"entities"> },
  _context: ToolExecutionContext
) {
  const entity = await ctx.db.get(params.entityId);
  if (!entity) throw new ConvexError("Entity not found");

  await ctx.db.patch(params.entityId, { visibility: "known" });

  return { entityId: params.entityId, name: entity.name };
}

async function execChangeScene(
  ctx: MutationCtx,
  params: { campaignId: Id<"campaigns">; title: string; description?: string },
  context: ToolExecutionContext
) {
  // Encerrar cena ativa atual
  const activeScene = await ctx.db
    .query("scenes")
    .withIndex("by_campaign", (q) => q.eq("campaignId", params.campaignId))
    .filter((q) => q.eq(q.field("status"), "active"))
    .unique();

  if (activeScene) {
    await ctx.db.patch(activeScene._id, {
      status: "completed",
      endedAt: Date.now(),
    });
  }

  // Criar nova cena
  const newSceneId = await ctx.db.insert("scenes", {
    campaignId: params.campaignId,
    title: params.title,
    description: params.description,
    status: "active",
    createdAt: Date.now(),
  });

  return { newSceneId, previousSceneId: activeScene?._id ?? null };
}

// ─── Dispatcher principal ─────────────────────────────────────────────────────

/**
 * Mutation interna que executa uma tool FATE pelo nome.
 * Chamada pelo loop de tool calling em processTurn.
 */
export const executeFateTool = internalMutation({
  args: {
    toolName: v.string(),
    toolParams: v.any(),
    context: v.object({
      campaignId: v.id("campaigns"),
      messageId: v.id("messages"),
      sceneId: v.id("scenes"),
    }),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const { toolName, toolParams, context } = args;
    const p = toolParams as Record<string, unknown>;

    switch (toolName) {
      case "award_fate_point":
        return execAwardFatePoint(
          ctx,
          { characterId: p.characterId as Id<"characters">, reason: p.reason as string },
          context
        );

      case "spend_fate_point":
        return execSpendFatePoint(
          ctx,
          { characterId: p.characterId as Id<"characters">, reason: p.reason as string },
          context
        );

      case "apply_stress":
        return execApplyStress(
          ctx,
          {
            characterId: p.characterId as Id<"characters">,
            amount: p.amount as number,
            track: p.track as "physical" | "mental",
          },
          context
        );

      case "apply_consequence":
        return execApplyConsequence(
          ctx,
          {
            characterId: p.characterId as Id<"characters">,
            severity: p.severity as "mild" | "moderate" | "severe",
            description: p.description as string,
          },
          context
        );

      case "add_scene_aspect":
        return execAddSceneAspect(
          ctx,
          {
            sceneId: p.sceneId as Id<"scenes">,
            text: p.text as string,
            freeInvokes: p.freeInvokes as number | undefined,
          },
          context
        );

      case "reveal_fact":
        return execRevealFact(
          ctx,
          { factId: p.factId as Id<"facts"> },
          context
        );

      case "reveal_entity":
        return execRevealEntity(
          ctx,
          { entityId: p.entityId as Id<"entities"> },
          context
        );

      case "change_scene":
        return execChangeScene(
          ctx,
          {
            campaignId: p.campaignId as Id<"campaigns">,
            title: p.title as string,
            description: p.description as string | undefined,
          },
          context
        );

      case "roll_fate_dice":
        // roll_fate_dice é tratado pelo rollFateDice wrapper (Ciclo 3)
        // Aqui apenas retornamos um marcador — o loop de tool calling chamará o wrapper de action separado
        throw new ConvexError(
          "roll_fate_dice deve ser executado via rollFateDiceWrapper (internalAction)"
        );

      case "invoke_aspect":
        // invoke_aspect requer uma rolagem existente — tratado pelo invokeAspectWrapper
        throw new ConvexError(
          "invoke_aspect deve ser executado via invokeAspectWrapper (internalMutation)"
        );

      case "compel_aspect":
        // compel_aspect é tratado diretamente pelo loop de processTurn (pausa o turno)
        throw new ConvexError(
          "compel_aspect é tratado diretamente pelo loop de processTurn"
        );

      default:
        throw new ConvexError(`Unknown tool: ${toolName}`);
    }
  },
});
