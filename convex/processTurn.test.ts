/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Helper: cria user + campaign e retorna os ids
async function setupCampaign(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "test@test.com",
      displayName: "Test User",
      tokenIdentifier: "token|processTurn-" + Math.random(),
    });
    const campaignId = await ctx.db.insert("campaigns", {
      userId,
      name: "Test Campaign",
      premise: "Uma aventura.",
      tone: "dark",
      expectedDuration: "one-shot",
      status: "active",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    });
    return { userId, campaignId };
  });
}

// Helper para criar SSE stream a partir de chunks de texto
function makeSseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`
          )
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

describe("processTurn (legado — args sem clientMessageId)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Caso 1: sem vazamento na 1ª tentativa → retorna { success: true, messageId }", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // LLM streaming
        return { ok: true, body: makeSseStream(["Resposta do GM."]) };
      } else if (callCount === 2) {
        // antiLeak — não vazou
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      } else {
        // factExtraction
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
          }),
        };
      }
    }));

    const result = await t.action(internal.processTurn.processTurn, {
      campaignId,
      hiddenFacts: [{ id: "fact_001", content: "O rei está morto." }],
      playerMessageContent: "O que você vê?",
    });

    expect(result).toMatchObject({ success: true });
    expect((result as { success: true; messageId: string }).messageId).toBeDefined();

    // Verifica que a mensagem GM ficou com status "complete"
    await t.run(async (ctx) => {
      const msgs = await ctx.db.query("messages").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).collect();
      const gmMsgs = msgs.filter((m) => m.role === "gm");
      expect(gmMsgs).toHaveLength(1);
      expect(gmMsgs[0].status).toBe("complete");
    });
  });

  it("Caso 2: vaza nas 2 primeiras tentativas, 3ª passa → retorna { success: true, messageId } com id da 3ª mensagem", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      // Sequência: LLM(1), antiLeak(2), LLM(3), antiLeak(4), LLM(5), antiLeak(6), factExtraction(7)
      if (callCount === 1 || callCount === 3 || callCount === 5) {
        return { ok: true, body: makeSseStream(["Resposta do GM."]) };
      } else if (callCount === 2 || callCount === 4) {
        // antileak: primeiras 2 vazam
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: true, facts: ["fact_001"], trechos: ["trecho"] }) } }],
          }),
        };
      } else if (callCount === 6) {
        // antiLeak da 3ª tentativa — não vaza
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      } else {
        // factExtraction
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
          }),
        };
      }
    }));

    const result = await t.action(internal.processTurn.processTurn, {
      campaignId,
      hiddenFacts: [{ id: "fact_001", content: "O rei está morto." }],
      playerMessageContent: "O que você vê?",
    });

    expect(result).toMatchObject({ success: true });
    const messageId = (result as { success: true; messageId: string }).messageId;
    expect(messageId).toBeDefined();

    // Verifica que as 2 primeiras ficaram "leaked" e a 3ª "complete"
    await t.run(async (ctx) => {
      const msgs = await ctx.db.query("messages").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).collect();
      const gmMsgs = msgs.filter((m) => m.role === "gm").sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      expect(gmMsgs).toHaveLength(3);
      expect(gmMsgs[0].status).toBe("leaked");
      expect(gmMsgs[1].status).toBe("leaked");
      expect(gmMsgs[2].status).toBe("complete");
      expect(gmMsgs[2]._id).toBe(messageId);
    });
  });

  it("Caso 3: vaza em todas as 3 tentativas → retorna { success: false, reason: 'max_regenerations_exceeded' } e última mensagem fica 'failed'", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string) => {
      callCount++;
      if (callCount === 1 || callCount === 3 || callCount === 5) {
        // LLM gerando resposta GM (streaming)
        return { ok: true, body: makeSseStream(["Resposta do GM."]) };
      } else {
        // validateAntiLeak — sempre vaza
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: true, facts: ["fact_001"], trechos: ["trecho"] }) } }],
          }),
        };
      }
    }));

    const result = await t.action(internal.processTurn.processTurn, {
      campaignId,
      hiddenFacts: [{ id: "fact_001", content: "O rei está morto." }],
      playerMessageContent: "O que você vê?",
    });

    expect(result).toEqual({ success: false, reason: "max_regenerations_exceeded" });

    // Verifica que as 2 primeiras mensagens ficaram "leaked" e a última "failed"
    await t.run(async (ctx) => {
      const msgs = await ctx.db.query("messages").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).collect();
      const gmMsgs = msgs.filter((m) => m.role === "gm").sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      expect(gmMsgs).toHaveLength(3);
      expect(gmMsgs[0].status).toBe("leaked");
      expect(gmMsgs[1].status).toBe("leaked");
      expect(gmMsgs[2].status).toBe("failed");
    });
  });
});

describe("processTurn (K1 — estágios com clientMessageId)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // HP1: todos os estágios chamados em ordem correta
  it("HP1: fluxo completo — mensagem GM fica 'complete' e fatos são extraídos no estágio 6", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Estágio 2: LLM gera resposta GM (streaming)
        return { ok: true, body: makeSseStream(["O rei está no castelo ao norte."]) };
      } else if (callCount === 2) {
        // Estágio 4: antiLeak — não vazou
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      } else {
        // Estágio 6: extractAndPersistFacts
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  facts: [{ content: "O rei está no castelo ao norte.", visibility: "known", relatedEntityIds: [] }],
                }),
              },
            }],
          }),
        };
      }
    }));

    const result = await t.action(internal.processTurn.processTurn, {
      campaignId,
      clientMessageId: "player-msg-001",
      hiddenFacts: [{ id: "fact_x", content: "O rei está morto." }],
      playerMessageContent: "O que você vê ao norte?",
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });
    const messageId = (result as { success: true; messageId: string }).messageId;
    expect(messageId).toBeDefined();

    await t.run(async (ctx) => {
      // Verifica mensagem GM com status complete
      const msg = await ctx.db.get(messageId as any);
      expect(msg).not.toBeNull();
      expect((msg as any)!.status).toBe("complete");

      // Verifica que o fato foi extraído (estágio 6 executado)
      const facts = await ctx.db
        .query("facts")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .collect();
      expect(facts).toHaveLength(1);
      expect(facts[0].content).toBe("O rei está no castelo ao norte.");
    });
  });

  // EC1: falha no estágio 6 (extractAndPersistFacts lança erro) → status "failed" com conteúdo parcial preservado
  it("EC1: erro no estágio 6 (extractAndPersistFacts) → mensagem fica 'failed' mas conteúdo GM é preservado", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Estágio 2: LLM gera resposta GM (streaming)
        return { ok: true, body: makeSseStream(["Conteúdo parcial do GM."]) };
      } else if (callCount === 2) {
        // Estágio 4: antiLeak — não vazou
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      } else {
        // Estágio 6: extractAndPersistFacts — erro de rede
        throw new Error("Network error in fact extraction");
      }
    }));

    const result = await t.action(internal.processTurn.processTurn, {
      campaignId,
      clientMessageId: "player-msg-002",
      hiddenFacts: [],
      playerMessageContent: "O que acontece?",
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: false });
    expect((result as { success: false; reason: string }).reason).toBe("fact_extraction_failed");

    await t.run(async (ctx) => {
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .collect();
      const gmMsgs = msgs.filter((m) => m.role === "gm");
      expect(gmMsgs).toHaveLength(1);
      // Conteúdo parcial preservado
      expect(gmMsgs[0].content).toBe("Conteúdo parcial do GM.");
      // Status reflete falha no estágio 6
      expect(gmMsgs[0].status).toBe("failed");
    });
  });
});

describe("processTurn (K2 — tool calls)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("HP1: LLM retorna tool_call JSON → content concatenado e toolCalls populado", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    const toolCallPayload = JSON.stringify({
      type: "tool_call",
      textBefore: "Você rola os dados...",
      toolName: "roll_fate_dice",
      toolParams: { numDice: 4 },
      toolResult: { dice: ["+", "+", "-", "0"], total: 1 },
      textAfter: "Resultado: +1. Você tem sucesso!",
    });

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Estágio 2: LLM retorna tool call (streaming)
        return { ok: true, body: makeSseStream([toolCallPayload]) };
      } else if (callCount === 2) {
        // Estágio 4: antiLeak — não vazou
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      } else {
        // Estágio 6: extractAndPersistFacts
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({ facts: [] }),
              },
            }],
          }),
        };
      }
    }));

    const result = await t.action(internal.processTurn.processTurn, {
      campaignId,
      clientMessageId: "player-msg-k2-001",
      hiddenFacts: [],
      playerMessageContent: "Rolo os dados!",
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });
    const messageId = (result as { success: true; messageId: string }).messageId;

    await t.run(async (ctx) => {
      const msg = await ctx.db.get(messageId as any);
      expect(msg).not.toBeNull();
      expect((msg as any)!.content).toBe("Você rola os dados... Resultado: +1. Você tem sucesso!");
      expect((msg as any)!.toolCalls).toHaveLength(1);
      expect((msg as any)!.toolCalls[0].toolName).toBe("roll_fate_dice");
      expect((msg as any)!.toolCalls[0].toolParams).toEqual({ numDice: 4 });
      expect((msg as any)!.toolCalls[0].toolResult).toEqual({ dice: ["+", "+", "-", "0"], total: 1 });
      expect(typeof (msg as any)!.toolCalls[0].executedAt).toBe("number");
    });
  });

  it("HP2: LLM retorna texto simples → comportamento igual ao K1 (sem regressão)", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, body: makeSseStream(["Texto simples do GM."]) };
      } else if (callCount === 2) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      } else {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
          }),
        };
      }
    }));

    const result = await t.action(internal.processTurn.processTurn, {
      campaignId,
      clientMessageId: "player-msg-k2-002",
      hiddenFacts: [],
      playerMessageContent: "O que acontece?",
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });
    const messageId = (result as { success: true; messageId: string }).messageId;

    await t.run(async (ctx) => {
      const msg = await ctx.db.get(messageId as any);
      expect(msg).not.toBeNull();
      expect((msg as any)!.content).toBe("Texto simples do GM.");
      // Sem tool calls
      const toolCalls = (msg as any)!.toolCalls;
      expect(toolCalls === undefined || toolCalls === null || toolCalls.length === 0).toBe(true);
    });
  });
});

describe("processTurn (streaming — G-002)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("HP1: stream de 3 chunks → mensagem GM final tem conteúdo acumulado e status complete", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // LLM streaming
        return { ok: true, body: makeSseStream(["Olá ", "mundo", "!"]) };
      } else if (callCount === 2) {
        // antiLeak
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      } else {
        // factExtraction
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
          }),
        };
      }
    }));

    const result = await t.action(internal.processTurn.processTurn, {
      campaignId,
      clientMessageId: "player-msg-g002-hp1",
      hiddenFacts: [],
      playerMessageContent: "Olá!",
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });
    const messageId = (result as { success: true; messageId: string }).messageId;

    await t.run(async (ctx) => {
      const msg = await ctx.db.get(messageId as any);
      expect(msg).not.toBeNull();
      expect((msg as any)!.content).toBe("Olá mundo!");
      expect((msg as any)!.status).toBe("complete");
    });
  });

  it("HP2: stream com chunk de 250 chars → conteúdo final correto no banco", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    const bigChunk = "a".repeat(250);
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, body: makeSseStream([bigChunk]) };
      } else if (callCount === 2) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      } else {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
          }),
        };
      }
    }));

    const result = await t.action(internal.processTurn.processTurn, {
      campaignId,
      clientMessageId: "player-msg-g002-hp2",
      hiddenFacts: [],
      playerMessageContent: "Texto longo!",
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });
    const messageId = (result as { success: true; messageId: string }).messageId;

    await t.run(async (ctx) => {
      const msg = await ctx.db.get(messageId as any);
      expect(msg).not.toBeNull();
      expect((msg as any)!.content).toBe(bigChunk);
    });
  });

  it("EC1: fetch retorna ok: false (429) → processTurn retorna failure ou lança erro", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Too Many Requests",
    }));

    let thrown = false;
    let result: unknown;
    try {
      result = await t.action(internal.processTurn.processTurn, {
        campaignId,
        clientMessageId: "player-msg-g002-ec1",
        hiddenFacts: [],
        playerMessageContent: "Qualquer coisa",
        antiLeakValidationEnabled: false,
      });
    } catch {
      thrown = true;
    }

    // Aceita tanto lançar erro quanto retornar { success: false }
    if (!thrown) {
      expect(result).toMatchObject({ success: false });
    } else {
      expect(thrown).toBe(true);
    }
  });
});

describe("processTurn (K3 — compel_aspect)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function setupCampaignWithSceneAndAspect(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "k3@test.com",
        displayName: "K3 User",
        tokenIdentifier: "token|k3-" + Math.random(),
      });
      const campaignId = await ctx.db.insert("campaigns", {
        userId,
        name: "K3 Campaign",
        premise: "Compel test.",
        tone: "dark",
        expectedDuration: "one-shot",
        status: "active",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      const characterId = await ctx.db.insert("characters", {
        campaignId,
        name: "Hero",
        aspects: ["Dívida com o demônio"],
        skills: {},
        stunts: [],
        fatePoints: 3,
        stress: { physical: [false, false], mental: [false, false] },
        consequences: [],
      });
      const sceneId = await ctx.db.insert("scenes", {
        campaignId,
        title: "Cena 1",
        status: "active",
        createdAt: Date.now(),
      });
      const aspectId = await ctx.db.insert("sceneAspects", {
        sceneId,
        text: "Dívida com o demônio",
        freeInvokes: 0,
      });
      return { campaignId, characterId, aspectId };
    });
  }

  it("HP1: tool call compel_aspect → retorna awaiting_player_decision com compelId válido", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, characterId, aspectId } = await setupCampaignWithSceneAndAspect(t);

    const compelPayload = JSON.stringify({
      type: "tool_call",
      textBefore: "Seu aspecto 'Dívida com o demônio' complica as coisas...",
      toolName: "compel_aspect",
      toolParams: {
        aspectId,
        characterId,
        complication: "O demônio aparece e exige pagamento agora.",
      },
      toolResult: null,
      textAfter: "",
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: makeSseStream([compelPayload]),
    }));

    const result = await t.action(internal.processTurn.processTurn, {
      campaignId,
      clientMessageId: "player-msg-k3-001",
      hiddenFacts: [],
      playerMessageContent: "O que acontece?",
      antiLeakValidationEnabled: false,
    });

    expect(result).toMatchObject({ status: "awaiting_player_decision" });
    const r = result as { status: "awaiting_player_decision"; compelId: string; messageId: string };
    expect(r.compelId).toBeDefined();
    expect(r.messageId).toBeDefined();

    await t.run(async (ctx) => {
      const compel = await ctx.db.get(r.compelId as any);
      expect(compel).not.toBeNull();
      expect((compel as any)!.status).toBe("pending");
      expect((compel as any)!.characterId).toBe(characterId);
      expect((compel as any)!.aspectId).toBe(aspectId);
    });
  });

  it("HP2: após compel pending, resolveCompelInternal com accept → status accepted", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, characterId, aspectId } = await setupCampaignWithSceneAndAspect(t);

    const compelId = await t.mutation(internal.compels.beginCompelInternal, {
      campaignId,
      aspectId,
      characterId,
      complication: "O demônio aparece e exige pagamento agora.",
    });

    await t.mutation(internal.compels.resolveCompelInternal, {
      compelId,
      decision: "accept",
    });

    await t.run(async (ctx) => {
      const compel = await ctx.db.get(compelId as any);
      expect((compel as any)!.status).toBe("accepted");
    });
  });
});
