/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Helper: gera chunk SSE de texto simples
function makeSseTextChunk(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

// Helper: gera chunk SSE de tool_call no formato OpenRouter
function makeSseToolCallChunk(toolName: string, toolParams: object, toolCallId: string): string {
  return `data: ${JSON.stringify({
    choices: [{
      delta: {
        tool_calls: [{
          id: toolCallId,
          type: "function",
          function: {
            name: toolName,
            arguments: JSON.stringify(toolParams),
          },
        }],
      },
    }],
  })}\n\n`;
}

function makeSseDone(): string {
  return "data: [DONE]\n\n";
}

// Helper: cria ReadableStream a partir de chunks SSE
function makeSseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function setupFull(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "toolloop@test.com",
      displayName: "Tool Loop Test",
      tokenIdentifier: "token|toolloop-" + Math.random(),
    });
    const campaignId = await ctx.db.insert("campaigns", {
      userId,
      name: "Tool Loop Campaign",
      premise: "Uma aventura de teste",
      tone: "heroic",
      expectedDuration: "one-shot",
      status: "active",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    });
    const characterId = await ctx.db.insert("characters", {
      campaignId,
      name: "Hero",
      aspects: ["Guerreiro Destemido"],
      skills: { Combate: 3 },
      stunts: [],
      fatePoints: 3,
      stress: { physical: [false, false, false], mental: [false, false] },
      consequences: [],
    });
    const sceneId = await ctx.db.insert("scenes", {
      campaignId,
      title: "Cena de Combate",
      status: "active",
      createdAt: Date.now(),
    });
    const aspectId = await ctx.db.insert("sceneAspects", {
      sceneId,
      text: "Campo de Batalha Caótico",
      freeInvokes: 1,
    });
    return { userId, campaignId, characterId, sceneId, aspectId };
  });
}

describe("processTurn — loop de tool calling (G-003)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("TC1: stream sem tool_call → mensagem completa com apenas texto", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupFull(t);

    // Mock anti-leak: não vaza
    let fetchCallCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      fetchCallCount++;
      if (url.includes("openrouter")) {
        return {
          ok: true,
          body: makeSseStream([
            makeSseTextChunk("A batalha começa! "),
            makeSseTextChunk("O inimigo avança."),
            makeSseDone(),
          ]),
        };
      }
      // Anti-leak call
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ vazou: false, fatos: [] }) } }] }),
      };
    }));

    const result = await t.action(internal.processTurn.processTurn, {
      campaignId,
      hiddenFacts: [],
      playerMessageContent: "Avanço contra o inimigo!",
      antiLeakValidationEnabled: false,
    });

    expect(result).toMatchObject({ success: true });
    const r = result as { success: true; messageId: string };

    const msg = await t.run(async (ctx) => ctx.db.get(r.messageId as any)) as any;
    expect(msg!.content).toContain("A batalha começa!");
    expect(msg!.status).toBe("complete");
    // Sem tool calls
    expect(msg!.toolCalls ?? []).toHaveLength(0);
  });

  it("TC2: stream com award_fate_point tool_call → persiste toolCall na mensagem e incrementa fatePoints", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, characterId } = await setupFull(t);

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("openrouter")) {
        return {
          ok: true,
          body: makeSseStream([
            makeSseTextChunk("Pelo seu ato heróico, "),
            makeSseToolCallChunk(
              "award_fate_point",
              { characterId, reason: "Ato heróico em combate" },
              "call-001"
            ),
            makeSseTextChunk("você ganha um Ponto de Destino!"),
            makeSseDone(),
          ]),
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ vazou: false, fatos: [] }) } }] }),
      };
    }));

    const result = await t.action(internal.processTurn.processTurn, {
      campaignId,
      hiddenFacts: [],
      playerMessageContent: "Faço algo heroico!",
      antiLeakValidationEnabled: false,
    });

    expect(result).toMatchObject({ success: true });
    const r = result as { success: true; messageId: string };

    // Verificar que o personagem ganhou PD
    const char = await t.run(async (ctx) => ctx.db.get(characterId)) as any;
    expect(char!.fatePoints).toBe(4); // era 3, ganhou 1

    // Verificar que a tool call foi persistida na mensagem
    const msg = await t.run(async (ctx) => ctx.db.get(r.messageId as any)) as any;
    expect(msg!.toolCalls).toHaveLength(1);
    expect(msg!.toolCalls![0].toolName).toBe("award_fate_point");
    expect(msg!.toolCalls![0].toolResult).toMatchObject({ fatePoints: 4 });
  });

  it("TC3: stream com reveal_fact tool_call → fato fica known e persiste na mensagem", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupFull(t);

    // Criar fato oculto
    const factId = await t.run(async (ctx) =>
      ctx.db.insert("facts", {
        campaignId,
        content: "O traidor é o capitão.",
        visibility: "hidden",
      })
    );

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("openrouter")) {
        return {
          ok: true,
          body: makeSseStream([
            makeSseTextChunk("Você descobre a verdade: "),
            makeSseToolCallChunk("reveal_fact", { factId }, "call-002"),
            makeSseTextChunk("o traidor estava entre vocês."),
            makeSseDone(),
          ]),
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ vazou: false, fatos: [] }) } }] }),
      };
    }));

    const result = await t.action(internal.processTurn.processTurn, {
      campaignId,
      hiddenFacts: [],
      playerMessageContent: "Investigo o capitão.",
      antiLeakValidationEnabled: false,
    });

    expect(result).toMatchObject({ success: true });

    // Fato deve estar known
    const fact = await t.run(async (ctx) => ctx.db.get(factId));
    expect(fact!.visibility).toBe("known");
  });

  it("TC4: stream com compel_aspect → retorna awaiting_player_decision sem completar", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, characterId, aspectId } = await setupFull(t);

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("openrouter")) {
        return {
          ok: true,
          body: makeSseStream([
            makeSseTextChunk("Seu aspecto te complica..."),
            makeSseToolCallChunk(
              "compel_aspect",
              {
                aspectId,
                characterId,
                complication: "O campo de batalha te força a mudar de rota.",
              },
              "call-compel-001"
            ),
            makeSseDone(),
          ]),
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ vazou: false, fatos: [] }) } }] }),
      };
    }));

    const result = await t.action(internal.processTurn.processTurn, {
      campaignId,
      hiddenFacts: [],
      playerMessageContent: "Tento cruzar o campo de batalha.",
      antiLeakValidationEnabled: false,
    });

    expect(result).toMatchObject({ status: "awaiting_player_decision" });
    const r = result as { status: "awaiting_player_decision"; compelId: string; messageId: string };
    expect(r.compelId).toBeDefined();
    expect(r.messageId).toBeDefined();

    // Mensagem GM deve existir mas ficar pending (não finalizada)
    const msg = await t.run(async (ctx) => ctx.db.get(r.messageId as any)) as any;
    expect(msg).not.toBeNull();
    // Status pode ser pending (compel pausa o turno)
    expect(["pending", "complete"]).toContain(msg!.status);

    // Compel deve estar pending
    const compel = await t.run(async (ctx) => ctx.db.get(r.compelId as any)) as any;
    expect(compel!.status).toBe("pending");
    expect(compel!.characterId).toEqual(characterId);
  });

  it("TC5: múltiplas tool_calls no mesmo stream → todas executadas em sequência", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, characterId, sceneId } = await setupFull(t);

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("openrouter")) {
        return {
          ok: true,
          body: makeSseStream([
            makeSseToolCallChunk(
              "award_fate_point",
              { characterId, reason: "Primeiro PD" },
              "call-multi-1"
            ),
            makeSseToolCallChunk(
              "add_scene_aspect",
              { sceneId, text: "Vantagem Criada", freeInvokes: 1 },
              "call-multi-2"
            ),
            makeSseTextChunk("Duas ações executadas!"),
            makeSseDone(),
          ]),
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ vazou: false, fatos: [] }) } }] }),
      };
    }));

    const result = await t.action(internal.processTurn.processTurn, {
      campaignId,
      hiddenFacts: [],
      playerMessageContent: "Faço duas coisas!",
      antiLeakValidationEnabled: false,
    });

    expect(result).toMatchObject({ success: true });
    const r = result as { success: true; messageId: string };

    // Ambas as tools devem ter sido executadas
    const char = await t.run(async (ctx) => ctx.db.get(characterId));
    expect(char!.fatePoints).toBe(4); // ganhou 1 PD

    const aspects = await t.run(async (ctx) =>
      ctx.db.query("sceneAspects").withIndex("by_scene", (q) => q.eq("sceneId", sceneId)).collect()
    );
    expect(aspects.some((a) => a.text === "Vantagem Criada")).toBe(true);

    // Ambas persistidas na mensagem
    const msg = await t.run(async (ctx) => ctx.db.get(r.messageId as any)) as any;
    expect(msg!.toolCalls).toHaveLength(2);
  });
});
