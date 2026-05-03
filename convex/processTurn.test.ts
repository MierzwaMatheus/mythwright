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

// Mock fetch: LLM sempre retorna conteúdo fixo "Resposta do GM."
function mockLlmFetch(llmContent: string = "Resposta do GM.") {
  return vi.fn().mockResolvedValue({
    json: async () => ({
      choices: [{ message: { content: llmContent } }],
    }),
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
      if (callCount % 2 === 1) {
        return { json: async () => ({ choices: [{ message: { content: "Resposta do GM." } }] }) };
      } else {
        return {
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
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
      if (callCount % 2 === 1) {
        return { json: async () => ({ choices: [{ message: { content: "Resposta do GM." } }] }) };
      } else {
        // antileak: primeiras 2 vazam, 3ª não
        const antiLeakCall = Math.floor(callCount / 2); // 1, 2, 3...
        const vazou = antiLeakCall < 3;
        return {
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou, facts: vazou ? ["fact_001"] : [], trechos: vazou ? ["trecho"] : [] }) } }],
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

    // fetch: primeiro responde ao LLM (3 vezes) e às 3 chamadas do validateAntiLeak
    // Para simplificar, usamos uma fila de respostas
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      callCount++;
      // Chamadas LLM (geracao de conteudo GM) — identificadas pela URL do OpenRouter
      // e chamadas validateAntiLeak (também OpenRouter)
      // Ambas passam pelo mesmo fetch; alternamos: LLM, antileak, LLM, antileak, LLM, antileak
      // Posições ímpares = LLM response, pares = antileak response (sempre vazou: true)
      if (callCount % 2 === 1) {
        // LLM gerando resposta GM
        return { json: async () => ({ choices: [{ message: { content: "Resposta do GM." } }] }) };
      } else {
        // validateAntiLeak — sempre vaza
        return {
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

    // fetch alternado: chamadas ímpares = LLM GM, pares = antiLeak (sem vazamento), resto = factExtraction
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Estágio 2: LLM gera resposta GM
        return { json: async () => ({ choices: [{ message: { content: "O rei está no castelo ao norte." } }] }) };
      } else if (callCount === 2) {
        // Estágio 4: antiLeak — não vazou
        return {
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      } else {
        // Estágio 6: extractAndPersistFacts
        return {
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
        // Estágio 2: LLM gera resposta GM
        return { json: async () => ({ choices: [{ message: { content: "Conteúdo parcial do GM." } }] }) };
      } else if (callCount === 2) {
        // Estágio 4: antiLeak — não vazou
        return {
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
        // Estágio 2: LLM retorna tool call
        return { json: async () => ({ choices: [{ message: { content: toolCallPayload } }] }) };
      } else if (callCount === 2) {
        // Estágio 4: antiLeak — não vazou
        return {
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      } else {
        // Estágio 6: extractAndPersistFacts
        return {
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
        return { json: async () => ({ choices: [{ message: { content: "Texto simples do GM." } }] }) };
      } else if (callCount === 2) {
        return {
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      } else {
        return {
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
