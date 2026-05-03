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

describe("processTurn", () => {
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
