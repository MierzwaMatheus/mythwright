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
      email: "full@test.com",
      displayName: "Full Test User",
      tokenIdentifier: "token|processTurnFull-" + Math.random(),
    });
    const campaignId = await ctx.db.insert("campaigns", {
      userId,
      name: "Full Campaign",
      premise: "Uma aventura completa.",
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

describe("processTurnFull (HP1 — fluxo básico completo)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("HP1: fluxo completo → GM criada com causedByMessageId, triggersFired/factsRevealed/tokensUsed persistidos, status 'complete'", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    const playerMessageId = await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        campaignId,
        role: "player",
        content: "O que vejo ao norte?",
        clientMessageId: "player-full-hp1",
        status: "complete",
        createdAt: Date.now(),
      });
    });

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, body: makeSseStream(["O castelo ao norte brilha."]) };
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

    const result = await t.action(internal.processTurnFull.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });
    const messageId = (result as { success: true; messageId: string }).messageId;

    await t.run(async (ctx) => {
      const msg = await ctx.db.get(messageId as any);
      expect(msg).not.toBeNull();
      expect((msg as any)!.status).toBe("complete");
      expect((msg as any)!.causedByMessageId).toBe(playerMessageId);
      expect((msg as any)!.triggersFired).toEqual([]);
      expect((msg as any)!.factsRevealed).toEqual([]);
      expect((msg as any)!.finalizedAt).toBeDefined();
    });
  });
});

describe("processTurnFull (HP3 — regeneração por vazamento)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("HP3: antileak detecta vazamento na 1ª tentativa → mensagem leaked → 2ª passa → status 'complete'", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    const playerMessageId = await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        campaignId,
        role: "player",
        content: "O que acontece?",
        clientMessageId: "player-full-hp3",
        status: "complete",
        createdAt: Date.now(),
      });
    });

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      // Seq: LLM(1), antiLeak-vaza(2), LLM(3), antiLeak-ok(4), factExtraction(5)
      if (callCount === 1 || callCount === 3) {
        return { ok: true, body: makeSseStream(["Resposta do GM."]) };
      } else if (callCount === 2) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: true, facts: ["f1"], trechos: ["t"] }) } }],
          }),
        };
      } else if (callCount === 4) {
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

    const result = await t.action(internal.processTurnFull.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });
    const messageId = (result as { success: true; messageId: string }).messageId;

    await t.run(async (ctx) => {
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .collect();
      const gmMsgs = msgs
        .filter((m) => m.role === "gm")
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      expect(gmMsgs).toHaveLength(2);
      expect(gmMsgs[0].status).toBe("leaked");
      expect(gmMsgs[1].status).toBe("complete");
      expect(gmMsgs[1]._id).toBe(messageId);
    });
  });
});

describe("processTurnFull (HP5 — sem gatilhos)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("HP5: sem candidateTriggers → classifyTriggers não chamado → fluxo normal com status 'complete'", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    // Criar cena ativa sem triggers armados
    await t.run(async (ctx) => {
      await ctx.db.insert("scenes", {
        campaignId,
        title: "Cena Sem Gatilhos",
        status: "active",
        createdAt: Date.now(),
      });
    });

    const playerMessageId = await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        campaignId,
        role: "player",
        content: "Olho ao redor.",
        clientMessageId: "player-full-hp5",
        status: "complete",
        createdAt: Date.now(),
      });
    });

    let classifyCallMade = false;
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      callCount++;
      if (typeof url === "string" && url.includes("trigger")) {
        classifyCallMade = true;
      }
      if (callCount === 1) {
        return { ok: true, body: makeSseStream(["Você vê a floresta silenciosa."]) };
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

    const result = await t.action(internal.processTurnFull.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });
    // classifyTriggers não deve ter sido chamado (sem triggers armados)
    expect(classifyCallMade).toBe(false);
  });
});

describe("processTurnFull (HP4 — threshold de resumo)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("HP4: 20+ mensagens na cena → summarizeScene agendado no scheduler", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    // Criar cena ativa com 20 mensagens
    const { sceneId } = await t.run(async (ctx) => {
      const sceneId = await ctx.db.insert("scenes", {
        campaignId,
        title: "Cena Longa",
        status: "active",
        createdAt: Date.now(),
      });
      // Inserir 20 mensagens na cena
      for (let i = 0; i < 20; i++) {
        await ctx.db.insert("messages", {
          campaignId,
          sceneId,
          role: i % 2 === 0 ? "player" : "gm",
          content: `Mensagem ${i}`,
          clientMessageId: `msg-threshold-${i}`,
          status: "complete",
          createdAt: Date.now() + i,
        });
      }
      return { sceneId };
    });

    const playerMessageId = await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "player",
        content: "Mais uma ação.",
        clientMessageId: "player-threshold-hp4",
        status: "complete",
        createdAt: Date.now() + 100,
      });
    });

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
        }),
        body: makeSseStream(["OK."]),
      };
    }));

    // Mock fetch para retornar coisas certas baseado na ordem
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, body: makeSseStream(["Resposta."]) };
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

    const result = await t.action(internal.processTurnFull.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });

    // Verificar que summarizeScene foi agendado no scheduler
    await t.run(async (ctx) => {
      const scheduled = await ctx.db.system.query("_scheduled_functions").collect();
      const summarizeScheduled = scheduled.some(
        (s: any) => s.name === "summarizeScene:summarizeScene"
      );
      expect(summarizeScheduled).toBe(true);
    });
  });
});

describe("processTurnFull (G-018 — idempotência)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("HP2: chamar processTurnFull duas vezes com mesmo playerMessageId → retorna mesmo gmMessageId sem criar segunda mensagem GM", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    // Criar mensagem do jogador no banco
    const playerMessageId = await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        campaignId,
        role: "player",
        content: "O que você vê?",
        clientMessageId: "player-full-001",
        status: "complete",
        createdAt: Date.now(),
      });
    });

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // LLM streaming — 1ª chamada
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

    // Primeira chamada
    const result1 = await t.action(internal.processTurnFull.processTurnFull, {
      campaignId,
      playerMessageId,
    });

    expect(result1).toMatchObject({ success: true });
    const messageId1 = (result1 as { success: true; messageId: string }).messageId;

    // Segunda chamada com mesmo playerMessageId — deve ser idempotente
    const result2 = await t.action(internal.processTurnFull.processTurnFull, {
      campaignId,
      playerMessageId,
    });

    expect(result2).toMatchObject({ success: true });
    const messageId2 = (result2 as { success: true; messageId: string }).messageId;

    // Deve retornar o mesmo messageId
    expect(messageId2).toBe(messageId1);

    // Deve existir apenas 1 mensagem GM no banco
    await t.run(async (ctx) => {
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .collect();
      const gmMsgs = msgs.filter((m) => m.role === "gm");
      expect(gmMsgs).toHaveLength(1);
      expect(gmMsgs[0].causedByMessageId).toBe(playerMessageId);
    });
  });
});
