import { internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { buildGmSystemPrompt } from "./prompts/gmSystemPrompt";
import { buildFullContext } from "./lib/contextBuilder";
import { retrieveSemanticContext } from "./lib/semanticMemory";
import { vectorSearch } from "./lib/vectorSearch";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_REGENERATIONS = 2;
const FLUSH_CHAR_THRESHOLD = 200;
const FLUSH_MS_THRESHOLD = 100;
const SUMMARY_THRESHOLD = 20;

type ToolCallRecord = {
  toolName: string;
  toolParams: unknown;
  toolResult: unknown;
  executedAt: number;
};

type StreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; toolName: string; toolParams: unknown; toolCallId: string };

async function* parseStreamingResponse(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          yield { type: "text_delta", delta: delta.content };
        }
        if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            if (tc.function?.name) {
              let params: unknown = {};
              try {
                params = JSON.parse(tc.function.arguments ?? "{}");
              } catch {}
              yield {
                type: "tool_call",
                toolName: tc.function.name,
                toolParams: params,
                toolCallId: tc.id ?? "",
              };
            }
          }
        }
      } catch {}
    }
  }
}

async function callLlm(
  messages: Array<{ role: string; content: string }>,
  model: string,
  tools?: unknown[]
): Promise<ReadableStream<Uint8Array>> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${errorText}`);
  }
  return response.body!;
}

export const processTurnFull = internalAction({
  args: {
    campaignId: v.id("campaigns"),
    playerMessageId: v.id("messages"),
    antiLeakValidationEnabled: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    | { success: true; messageId: Id<"messages"> }
    | { success: false; reason: string }
    | { status: "awaiting_player_decision"; compelId: Id<"compels">; messageId: Id<"messages"> }
  > => {
    // --- GUARD DE IDEMPOTÊNCIA ---
    const existingGmMessage = await ctx.runQuery(
      internal.messages.findGmByCausedByInternal,
      { causedByMessageId: args.playerMessageId }
    );
    if (existingGmMessage !== null && existingGmMessage.status === "complete") {
      return { success: true, messageId: existingGmMessage._id };
    }

    // --- BUSCAR DADOS BASE ---
    const [playerMessage, campaign, activeScene] = await Promise.all([
      ctx.runQuery(internal.messages.getByIdInternal, {
        messageId: args.playerMessageId,
      }),
      ctx.runQuery(internal.campaigns.getByIdInternal, {
        campaignId: args.campaignId,
      }),
      ctx.runQuery(internal.scenes.getActiveSceneInternal, {
        campaignId: args.campaignId,
      }),
    ]);

    if (!playerMessage) {
      return { success: false, reason: "player_message_not_found" };
    }
    if (!campaign) {
      return { success: false, reason: "campaign_not_found" };
    }

    const llmConfig = await ctx.runQuery(
      internal.lib.llmConfig.getLlmConfigInternal,
      { campaignId: args.campaignId }
    );

    const systemPrompt = buildGmSystemPrompt({
      tone: campaign.tone,
      premise: campaign.premise,
    });

    // --- ESTÁGIO 2: montagem do contexto semântico ---
    const queryEmbedding = await ctx.runAction(
      internal.lib.embedding.generateEmbedding,
      { text: playerMessage.content }
    );

    const [semanticCtx, character, recentMessages, sceneAspects] = await Promise.all([
      retrieveSemanticContext(ctx, { campaignId: args.campaignId, queryEmbedding }),
      ctx.runQuery(internal.characters.getByCampaignIdInternal, { campaignId: args.campaignId }),
      activeScene
        ? ctx.runQuery(internal.messages.getRecentBySceneInternal, { sceneId: activeScene._id, limit: 10 })
        : Promise.resolve([]),
      activeScene
        ? ctx.runQuery(internal.sceneAspects.getBySceneInternal, { sceneId: activeScene._id })
        : Promise.resolve([]),
    ]);

    const campaignForContext = { name: campaign.name, systemPrompt };
    const sceneForContext = activeScene
      ? { title: activeScene.title, description: activeScene.description, status: activeScene.status }
      : { title: "Sem cena ativa", status: "inactive" as const };
    const messagesForContext = [...recentMessages].reverse().map((m) => ({
      role: m.role === "gm" ? ("assistant" as const) : ("user" as const),
      content: m.content,
      status: m.status === "failed" ? ("failed" as const) : ("ok" as const),
    }));
    messagesForContext.push({ role: "user" as const, content: playerMessage.content, status: "ok" as const });

    const characterForContext = character ?? {
      name: "Desconhecido",
      aspects: [],
      skills: {},
      stunts: [],
      fatePoints: 3,
      stress: { physical: [false, false, false], mental: [false, false, false] },
      consequences: [],
    };

    const aspectEvents = sceneAspects.map((a) => ({ name: a.text, description: `${a.freeInvokes} invocações livres` }));

    // --- ESTÁGIO 3: classificação e disparo de triggers ---
    const triggersFired: Id<"triggers">[] = [];
    const factsRevealedFromTriggers: Id<"facts">[] = [];
    const triggeredEventDescriptions: Array<{ name: string; description: string }> = [];

    const armedTriggers = await ctx.runQuery(api.triggers.getArmedTriggersByScope, {
      campaignId: args.campaignId,
      sceneId: activeScene?._id,
    });

    if (armedTriggers.length > 0) {
      const triggerSearchResults = await vectorSearch(
        ctx,
        "triggers",
        "by_embedding",
        queryEmbedding,
        { campaignId: args.campaignId },
        armedTriggers.length * 2,
      );

      const armedIdSet = new Set(armedTriggers.map((t) => t._id as string));
      const ranked = triggerSearchResults.filter((r) => armedIdSet.has(r._id));

      // Fallback para pré-filtro quando nenhum trigger tem embedding ainda
      const topK = ranked.length > 0 ? ranked.slice(0, 5) : armedTriggers.slice(0, 5).map((t) => ({ _id: t._id as string, _score: 1 }));

      const candidates = topK.map((r) => {
        const trigger = armedTriggers.find((t) => (t._id as string) === r._id)!;
        return { id: r._id, description: trigger.description, scope: trigger.scope };
      });

      if (candidates.length > 0) {
        const sceneSummary = activeScene
          ? `${activeScene.title}: ${activeScene.description ?? ""}`
          : "";

        const classified = await ctx.runAction(internal.classifyTriggers.classifyTriggers, {
          campaignId: args.campaignId,
          playerMessage: playerMessage.content,
          sceneSummary,
          candidates,
        });

        for (const triggerId of classified.activatedIds) {
          const result = await ctx.runMutation(internal.triggers.fireTrigger, {
            triggerId: triggerId as Id<"triggers">,
            firedByMessageId: args.playerMessageId,
          });
          triggersFired.push(triggerId as Id<"triggers">);
          factsRevealedFromTriggers.push(...result.revealedFactIds);
          const trigger = armedTriggers.find((t) => (t._id as string) === triggerId);
          if (trigger) {
            triggeredEventDescriptions.push({ name: trigger.description, description: "trigger disparado" });
          }
        }
      }
    }

    const firedEvents = [...aspectEvents, ...triggeredEventDescriptions];

    const llmMessages = buildFullContext(
      campaignForContext,
      characterForContext,
      sceneForContext,
      messagesForContext,
      semanticCtx.facts,
      semanticCtx.summaries,
      firedEvents,
    );

    // --- LOOP DE REGENERAÇÃO ---
    for (let attempt = 0; attempt <= MAX_REGENERATIONS; attempt++) {
      // Criar stub de mensagem GM com causedByMessageId
      const gmMessageId: Id<"messages"> = await ctx.runMutation(
        internal.messages.createGmStubInternal,
        {
          campaignId: args.campaignId,
          causedByMessageId: args.playerMessageId,
          ...(activeScene ? { sceneId: activeScene._id } : {}),
        }
      );

      // Streaming
      const streamBody = await callLlm(llmMessages, llmConfig.narrativeModel);

      let pendingBuffer = "";
      let fullText = "";
      let lastFlushAt = Date.now();
      const accumulatedToolCalls: ToolCallRecord[] = [];

      for await (const event of parseStreamingResponse(streamBody)) {
        if (event.type === "text_delta") {
          pendingBuffer += event.delta;
          fullText += event.delta;
          const now = Date.now();
          const shouldFlush =
            pendingBuffer.length >= FLUSH_CHAR_THRESHOLD ||
            now - lastFlushAt >= FLUSH_MS_THRESHOLD;
          if (shouldFlush) {
            await ctx.runMutation(api.messages.appendMessageTokens, {
              messageId: gmMessageId,
              tokens: pendingBuffer,
            });
            pendingBuffer = "";
            lastFlushAt = Date.now();
          }
        } else if (event.type === "tool_call") {
          if (pendingBuffer.length > 0) {
            await ctx.runMutation(api.messages.appendMessageTokens, {
              messageId: gmMessageId,
              tokens: pendingBuffer,
            });
            pendingBuffer = "";
            lastFlushAt = Date.now();
          }

          if (event.toolName === "compel_aspect") {
            const params = event.toolParams as {
              aspectId: Id<"sceneAspects">;
              characterId: Id<"characters">;
              complication: string;
            };
            const compelId: Id<"compels"> = await ctx.runMutation(
              internal.compels.beginCompelInternal,
              {
                campaignId: args.campaignId,
                aspectId: params.aspectId,
                characterId: params.characterId,
                complication: params.complication,
                triggeringMessageId: args.playerMessageId,
                pausedGmMessageId: gmMessageId,
              }
            );
            await ctx.runMutation(internal.processTurn.updateGmMessageContent, {
              messageId: gmMessageId,
              content: fullText,
              toolCalls: accumulatedToolCalls,
            });
            return {
              status: "awaiting_player_decision",
              compelId,
              messageId: gmMessageId,
            };
          } else {
            const toolResult = await ctx.runMutation(
              internal.tools.executor.executeFateTool,
              {
                toolName: event.toolName,
                toolParams: event.toolParams,
                context: {
                  campaignId: args.campaignId,
                  messageId: gmMessageId,
                  sceneId: (activeScene?._id ?? "") as Id<"scenes">,
                },
              }
            );
            accumulatedToolCalls.push({
              toolName: event.toolName,
              toolParams: event.toolParams,
              toolResult,
              executedAt: Date.now(),
            });
          }
        }
      }

      // Flush final
      if (pendingBuffer.length > 0) {
        await ctx.runMutation(api.messages.appendMessageTokens, {
          messageId: gmMessageId,
          tokens: pendingBuffer,
        });
      }

      // Persistir conteúdo final e tool calls
      await ctx.runMutation(internal.processTurn.updateGmMessageContent, {
        messageId: gmMessageId,
        content: fullText,
        toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
      });

      // AntiLeak
      const antiLeakEnabled = args.antiLeakValidationEnabled !== false;
      if (!antiLeakEnabled) {
        try {
          await ctx.runAction(internal.prompts.factExtraction.extractAndPersistFacts, {
            messageId: gmMessageId,
            campaignId: args.campaignId,
          });
        } catch {
          await ctx.runMutation(internal.processTurn.markMessageStatus, {
            messageId: gmMessageId,
            status: "failed",
          });
          return { success: false, reason: "fact_extraction_failed" };
        }
        await ctx.runMutation(internal.messages.finalizeTurnMessageInternal, {
          gmMessageId,
          triggersFired,
          factsRevealed: factsRevealedFromTriggers,
        });
        return { success: true, messageId: gmMessageId };
      }

      // --- ESTÁGIO 5: recuperar hidden facts relevantes para anti-leak ---
      const gmEmbedding = await ctx.runAction(internal.lib.embedding.generateEmbedding, {
        text: fullText,
      });
      const hiddenFactSearchResults = await vectorSearch(
        ctx,
        "facts",
        "by_embedding",
        gmEmbedding,
        { campaignId: args.campaignId },
        30,
      );
      const hiddenFactDocs = await Promise.all(
        hiddenFactSearchResults.slice(0, 10).map((r) =>
          ctx.runQuery(internal.facts.getByIdInternal, { factId: r._id as Id<"facts"> })
        )
      );
      const hiddenFacts = hiddenFactDocs
        .filter((d): d is NonNullable<typeof d> => d !== null && d.visibility === "hidden")
        .map((d) => ({ id: d._id as string, content: d.content }));

      // --- ESTÁGIOS 5 e 6 em paralelo ---
      const [leakResult, factExtractionError] = await Promise.all([
        ctx.runAction(internal.prompts.antiLeak.validateAntiLeak, {
          messageId: gmMessageId,
          campaignId: args.campaignId,
          hiddenFacts,
        }),
        ctx.runAction(internal.prompts.factExtraction.extractAndPersistFacts, {
          messageId: gmMessageId,
          campaignId: args.campaignId,
        }).then(() => null).catch((e: unknown) => e),
      ]);

      if (factExtractionError !== null && !leakResult.vazou) {
        await ctx.runMutation(internal.processTurn.markMessageStatus, {
          messageId: gmMessageId,
          status: "failed",
        });
        return { success: false, reason: "fact_extraction_failed" };
      }

      if (!leakResult.vazou) {

        // Estágio 7: housekeeping
        await ctx.runMutation(internal.messages.finalizeTurnMessageInternal, {
          gmMessageId,
          triggersFired,
          factsRevealed: factsRevealedFromTriggers,
        });

        await ctx.scheduler.runAfter(0, internal.lib.embedding.embedMessage, { messageId: gmMessageId, content: fullText });

        // Estágio 8: threshold de resumo
        if (activeScene) {
          const msgCount = await ctx.runQuery(
            internal.messages.countBySceneInternal,
            { sceneId: activeScene._id }
          );
          if (msgCount >= SUMMARY_THRESHOLD) {
            await ctx.scheduler.runAfter(0, internal.summarizeScene.summarizeScene, {
              sceneId: activeScene._id,
            });
          }
        }

        return { success: true, messageId: gmMessageId };
      }

      if (attempt < MAX_REGENERATIONS) {
        await ctx.runMutation(internal.processTurn.markMessageStatus, {
          messageId: gmMessageId,
          status: "leaked",
        });
      } else {
        await ctx.runMutation(internal.processTurn.markMessageStatus, {
          messageId: gmMessageId,
          status: "failed",
        });
        return { success: false, reason: "max_regenerations_exceeded" };
      }
    }

    return { success: false, reason: "max_regenerations_exceeded" };
  },
});

export const continueAfterCompel = internalAction({
  args: {
    playerMessageId: v.id("messages"),
    gmMessageId: v.id("messages"),
    compelId: v.id("compels"),
    antiLeakValidationEnabled: v.optional(v.boolean()),
    // Optional pre-fetched compel data (used when called from scheduler to avoid runQuery bug in convex-test)
    _compelStatus: v.optional(v.union(v.literal("accepted"), v.literal("refused"), v.literal("pending"))),
    _compelComplication: v.optional(v.string()),
    _compelCampaignId: v.optional(v.id("campaigns")),
  },
  handler: async (ctx, args): Promise<
    | { success: true; messageId: Id<"messages"> }
    | { success: false; reason: string }
  > => {
    // 1. Buscar compel (ou usar dados pré-carregados para evitar runQuery em scheduled context)
    let compel: { status: string; complication: string; campaignId: Id<"campaigns"> } | null = null;
    if (args._compelStatus && args._compelComplication && args._compelCampaignId) {
      compel = {
        status: args._compelStatus,
        complication: args._compelComplication,
        campaignId: args._compelCampaignId,
      };
    } else {
      try {
        compel = await ctx.runQuery(internal.compels.getById, { compelId: args.compelId });
      } catch (e) {
        return { success: false, reason: "compel_not_found" };
      }
    }
    if (!compel) return { success: false, reason: "compel_not_found" };

    // 2. Append compel_resolution tool call na gmMessage
    try {
      await ctx.runMutation(api.messages.appendToolCall, {
        messageId: args.gmMessageId,
        toolName: "compel_resolution",
        toolParams: { compelId: args.compelId },
        toolResult: {
          decision: compel.status,
          fatePointDelta: compel.status === "accepted" ? +1 : -1,
        },
      });
    } catch (e) {
      console.error("continueAfterCompel: appendToolCall failed:", e);
      // Non-fatal: continue without appending tool call
    }

    // 3. Buscar dados base
    const [playerMessage, campaign] = await Promise.all([
      ctx.runQuery(internal.messages.getByIdInternal, { messageId: args.playerMessageId }),
      ctx.runQuery(internal.campaigns.getByIdInternal, { campaignId: compel.campaignId }),
    ]);

    if (!playerMessage) return { success: false, reason: "player_message_not_found" };
    if (!campaign) return { success: false, reason: "campaign_not_found" };

    const llmConfig = await ctx.runQuery(internal.lib.llmConfig.getLlmConfigInternal, {
      campaignId: compel.campaignId,
    });

    const systemPrompt = buildGmSystemPrompt({ tone: campaign.tone, premise: campaign.premise });

    // 4. Montar mensagens para LLM incluindo decisão do compel
    const compelContext = compel.status === "accepted"
      ? `O jogador ACEITOU o compel "${compel.complication}". Continue a narrativa com essa complicação.`
      : `O jogador RECUSOU o compel "${compel.complication}" gastando um Ponto de Destino. Continue sem essa complicação.`;

    const llmMessages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: playerMessage.content },
      { role: "assistant", content: `[Compel proposto: ${compel.complication}]` },
      { role: "user", content: compelContext },
    ];

    // 5. Streaming
    const streamBody = await callLlm(llmMessages, llmConfig.narrativeModel);
    let pendingBuffer = "";
    let fullText = "";
    let lastFlushAt = Date.now();

    for await (const event of parseStreamingResponse(streamBody)) {
      if (event.type === "text_delta") {
        pendingBuffer += event.delta;
        fullText += event.delta;
        const now = Date.now();
        if (pendingBuffer.length >= FLUSH_CHAR_THRESHOLD || now - lastFlushAt >= FLUSH_MS_THRESHOLD) {
          await ctx.runMutation(api.messages.appendMessageTokens, {
            messageId: args.gmMessageId,
            tokens: pendingBuffer,
          });
          pendingBuffer = "";
          lastFlushAt = Date.now();
        }
      }
    }

    if (pendingBuffer.length > 0) {
      await ctx.runMutation(api.messages.appendMessageTokens, {
        messageId: args.gmMessageId,
        tokens: pendingBuffer,
      });
    }

    // 6. Persistir conteúdo final
    await ctx.runMutation(internal.processTurn.updateGmMessageContent, {
      messageId: args.gmMessageId,
      content: fullText,
    });

    // 7. AntiLeak + extração de fatos + finalização
    const antiLeakEnabled = args.antiLeakValidationEnabled === true;
    if (!antiLeakEnabled) {
      await ctx.runMutation(internal.messages.finalizeTurnMessageInternal, {
        gmMessageId: args.gmMessageId,
        triggersFired: [],
        factsRevealed: [],
      });
      return { success: true, messageId: args.gmMessageId };
    }

    const leakResult = await ctx.runAction(internal.prompts.antiLeak.validateAntiLeak, {
      messageId: args.gmMessageId,
      campaignId: compel.campaignId,
      hiddenFacts: [],
    });

    if (!leakResult.vazou) {
      try {
        await ctx.runAction(internal.prompts.factExtraction.extractAndPersistFacts, {
          messageId: args.gmMessageId,
          campaignId: compel.campaignId,
        });
      } catch {
        await ctx.runMutation(internal.processTurn.markMessageStatus, {
          messageId: args.gmMessageId,
          status: "failed",
        });
        return { success: false, reason: "fact_extraction_failed" };
      }

      await ctx.runMutation(internal.messages.finalizeTurnMessageInternal, {
        gmMessageId: args.gmMessageId,
        triggersFired: [],
        factsRevealed: [],
      });
      return { success: true, messageId: args.gmMessageId };
    }

    await ctx.runMutation(internal.processTurn.markMessageStatus, {
      messageId: args.gmMessageId,
      status: "failed",
    });
    return { success: false, reason: "anti_leak_failed" };
  },
});
