import { internalAction, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_REGENERATIONS = 2; // 3 tentativas no total (0, 1, 2)
const FLUSH_CHAR_THRESHOLD = 200;
const FLUSH_MS_THRESHOLD = 100;

type ToolCallRecord = {
  toolName: string;
  toolParams: unknown;
  toolResult: unknown;
  executedAt: number;
};


type StreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; toolName: string; toolParams: unknown; toolCallId: string };

async function* parseStreamingResponse(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
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
              try { params = JSON.parse(tc.function.arguments ?? "{}"); } catch {}
              yield { type: "tool_call", toolName: tc.function.name, toolParams: params, toolCallId: tc.id ?? "" };
            }
          }
        }
      } catch {}
    }
  }
}

async function callLlm(playerMessageContent: string, model: string): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: playerMessageContent }],
      stream: true,
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${errorText}`);
  }
  return response.body!;
}

export const markMessageStatus = internalMutation({
  args: {
    messageId: v.id("messages"),
    status: v.union(v.literal("pending"), v.literal("complete"), v.literal("failed"), v.literal("leaked")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { status: args.status });
  },
});

export const createGmMessage = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    content: v.string(),
    toolCalls: v.optional(v.array(v.object({
      toolName: v.string(),
      toolParams: v.any(),
      toolResult: v.any(),
      executedAt: v.number(),
    }))),
  },
  handler: async (ctx, args): Promise<Id<"messages">> => {
    return await ctx.db.insert("messages", {
      campaignId: args.campaignId,
      role: "gm",
      content: args.content,
      clientMessageId: "gm-" + Date.now() + "-" + Math.random(),
      status: "pending",
      createdAt: Date.now(),
      ...(args.toolCalls !== undefined ? { toolCalls: args.toolCalls } : {}),
    });
  },
});

export const processTurn = internalAction({
  args: {
    campaignId: v.id("campaigns"),
    clientMessageId: v.optional(v.string()),
    hiddenFacts: v.array(v.object({ id: v.string(), content: v.string() })),
    playerMessageContent: v.string(),
    antiLeakValidationEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<
    | { success: true; messageId: Id<"messages"> }
    | { success: false; reason: string }
    | { status: "awaiting_player_decision"; compelId: Id<"compels">; messageId: Id<"messages"> }
  > => {
    const llmConfig = await ctx.runQuery(internal.lib.llmConfig.getLlmConfigInternal, { campaignId: args.campaignId });
    for (let attempt = 0; attempt <= MAX_REGENERATIONS; attempt++) {
      // Streaming: obter o body SSE do LLM
      const streamBody = await callLlm(args.playerMessageContent, llmConfig.narrativeModel);

      // Criar stub de mensagem GM com content vazio antes de stremar
      const gmMessageId: Id<"messages"> = await ctx.runMutation(internal.processTurn.createGmMessage, {
        campaignId: args.campaignId,
        content: "",
      });

      // Iterar o stream acumulando texto e tool calls
      let pendingBuffer = "";
      let fullText = "";
      let lastFlushAt = Date.now();
      const accumulatedToolCalls: ToolCallRecord[] = [];

      // Obter cena ativa para o contexto das tools
      const activeScene = await ctx.runQuery(internal.scenes.getActiveSceneInternal, { campaignId: args.campaignId });

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
          // Flush texto pendente antes de executar a tool
          if (pendingBuffer.length > 0) {
            await ctx.runMutation(api.messages.appendMessageTokens, {
              messageId: gmMessageId,
              tokens: pendingBuffer,
            });
            pendingBuffer = "";
            lastFlushAt = Date.now();
          }

          if (event.toolName === "compel_aspect") {
            // compel_aspect pausa o turno — registrar e parar o stream
            const params = event.toolParams as { aspectId: Id<"sceneAspects">; characterId: Id<"characters">; complication: string };
            const compelId: Id<"compels"> = await ctx.runMutation(internal.compels.beginCompelInternal, {
              campaignId: args.campaignId,
              aspectId: params.aspectId,
              characterId: params.characterId,
              complication: params.complication,
            });
            // Persistir conteúdo parcial na mensagem antes de pausar
            await ctx.runMutation(internal.processTurn.updateGmMessageContent, {
              messageId: gmMessageId,
              content: fullText,
              toolCalls: accumulatedToolCalls,
            });
            return { status: "awaiting_player_decision", compelId, messageId: gmMessageId };
          } else {
            // Executar tool via mutation
            const toolResult = await ctx.runMutation(internal.tools.executor.executeFateTool, {
              toolName: event.toolName,
              toolParams: event.toolParams,
              context: {
                campaignId: args.campaignId,
                messageId: gmMessageId,
                sceneId: (activeScene?._id ?? "") as Id<"scenes">,
              },
            });
            accumulatedToolCalls.push({
              toolName: event.toolName,
              toolParams: event.toolParams,
              toolResult,
              executedAt: Date.now(),
            });
          }
        }
      }

      // Flush final do buffer pendente
      if (pendingBuffer.length > 0) {
        await ctx.runMutation(api.messages.appendMessageTokens, {
          messageId: gmMessageId,
          tokens: pendingBuffer,
        });
      }

      // Persistir conteúdo final e tool calls acumuladas
      await ctx.runMutation(internal.processTurn.updateGmMessageContent, {
        messageId: gmMessageId,
        content: fullText,
        toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
      });

      // Respeitar antiLeakValidationEnabled
      const antiLeakEnabled = args.antiLeakValidationEnabled !== false;

      if (!antiLeakEnabled) {
        await ctx.runMutation(internal.processTurn.markMessageStatus, {
          messageId: gmMessageId,
          status: "complete",
        });
        return { success: true, messageId: gmMessageId };
      }

      const leakResult = await ctx.runAction(internal.prompts.antiLeak.validateAntiLeak, {
        messageId: gmMessageId,
        campaignId: args.campaignId,
        hiddenFacts: args.hiddenFacts,
      });

      if (!leakResult.vazou) {
        await ctx.runMutation(internal.processTurn.markMessageStatus, {
          messageId: gmMessageId,
          status: "complete",
        });

        // Estágio 6: extrair e persistir fatos
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

export const updateGmMessageContent = internalMutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
    toolCalls: v.optional(v.array(v.object({
      toolName: v.string(),
      toolParams: v.any(),
      toolResult: v.any(),
      executedAt: v.number(),
    }))),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      content: args.content,
      ...(args.toolCalls !== undefined ? { toolCalls: args.toolCalls } : {}),
    });
  },
});
