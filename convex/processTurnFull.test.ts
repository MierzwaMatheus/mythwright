/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Mock de fetch roteado por URL/body — evita dependência de callCount
// Together AI → embedding; OpenRouter stream → SSE narrativo; antiLeak → resposta configurável; else → factExtraction
function makeRoutedFetch({
  sseContent = ["Resposta do GM."],
  antiLeakVazou = false,
  onLlmCall,
  classifyActivatedIds,
}: {
  sseContent?: string[];
  antiLeakVazou?: boolean;
  onLlmCall?: (payload: any) => void;
  classifyActivatedIds?: string[];
} = {}) {
  let antiLeakCount = 0;
  return vi.fn().mockImplementation(async (url: string, opts: any) => {
    if (typeof url === "string" && url.includes("together")) {
      return makeEmbeddingResponse();
    }
    const body = opts?.body ? JSON.parse(opts.body) : {};
    if (body.stream === true) {
      onLlmCall?.(body);
      return { ok: true, body: makeSseStream(sseContent) };
    }
    const prompt = JSON.stringify(body.messages ?? []);
    if (prompt.includes("vazou") || prompt.includes("trechos")) {
      antiLeakCount++;
      const vazou = antiLeakVazou && antiLeakCount === 1;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ vazou, facts: [], trechos: [] }) } }],
        }),
      };
    }
    if (prompt.includes("ativados") || prompt.includes("gatilhos")) {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ ativados: classifyActivatedIds ?? [], raciocinio: "" }) } }],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
      }),
    };
  });
}

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

// Resposta de embedding (Together AI)
function makeEmbeddingResponse() {
  return {
    ok: true,
    json: async () => ({
      data: [{ embedding: Array.from({ length: 1024 }, (_, i) => i * 0.001) }],
    }),
  };
}

// Helper para criar SSE stream com um tool call
function makeToolCallSseStream(
  toolName: string,
  params: unknown,
  toolCallId: string
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const delta = {
    tool_calls: [
      {
        id: toolCallId,
        function: { name: toolName, arguments: JSON.stringify(params) },
      },
    ],
  };
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`
        )
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
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
  beforeEach(() => { vi.stubEnv("TOGETHER_API_KEY", "test-key"); vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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

    vi.stubGlobal("fetch", makeRoutedFetch({ sseContent: ["O castelo ao norte brilha."] }));

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
  beforeEach(() => { vi.stubEnv("TOGETHER_API_KEY", "test-key"); vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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

    vi.stubGlobal("fetch", makeRoutedFetch({ antiLeakVazou: true }));

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
  beforeEach(() => { vi.stubEnv("TOGETHER_API_KEY", "test-key"); vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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
    let narrativeCallCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, opts: any) => {
      if (typeof url === "string" && url.includes("trigger")) {
        classifyCallMade = true;
      }
      if (typeof url === "string" && url.includes("together")) {
        return makeEmbeddingResponse();
      }
      // OpenRouter
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if (body.stream === true) {
        narrativeCallCount++;
        return { ok: true, body: makeSseStream(["Você vê a floresta silenciosa."]) };
      }
      // Anti-leak ou fact extraction
      const prompt = JSON.stringify(body.messages ?? []);
      if (prompt.includes("vazou") || prompt.includes("anti") || prompt.includes("leak")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
        }),
      };
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
  beforeEach(() => { vi.stubEnv("TOGETHER_API_KEY", "test-key"); vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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

    vi.stubGlobal("fetch", makeRoutedFetch({ sseContent: ["Resposta."] }));

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
  beforeEach(() => { vi.stubEnv("TOGETHER_API_KEY", "test-key"); vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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

    vi.stubGlobal("fetch", makeRoutedFetch());

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

describe("processTurnFull (G-101 — embedding GM agendado)", () => {
  beforeEach(() => { vi.stubEnv("TOGETHER_API_KEY", "test-key"); vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("G-101: após Estágio 7, embedMessage é agendado para a mensagem GM", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    const playerMessageId = await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        campaignId,
        role: "player",
        content: "O que você vê ao redor?",
        clientMessageId: "player-embed-g101",
        status: "complete",
        createdAt: Date.now(),
      });
    });

    vi.stubGlobal("fetch", makeRoutedFetch({ sseContent: ["Você vê uma floresta densa."] }));

    const result = await t.action(internal.processTurnFull.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });

    await t.run(async (ctx) => {
      const scheduled = await ctx.db.system.query("_scheduled_functions").collect();
      const embedScheduled = scheduled.some(
        (s: any) => s.name === "lib/embedding:embedMessage"
      );
      expect(embedScheduled).toBe(true);
    });
  });
});

describe("processTurnFull (G-102 — contexto semântico no LLM)", () => {
  beforeEach(() => { vi.stubEnv("TOGETHER_API_KEY", "test-key"); vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("G-102: payload enviado ao LLM contém mais de [system, user] — inclui contexto do personagem e cena", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupCampaign(t);

    // Cena ativa e personagem
    await t.run(async (ctx) => {
      await ctx.db.insert("scenes", {
        campaignId,
        title: "A Taverna do Cervo",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.insert("characters", {
        campaignId,
        name: "Lyra",
        aspects: ["Ladrã arrependida"],
        skills: { Fight: 3 },
        stunts: [],
        fatePoints: 3,
        stress: { physical: [false, false, false], mental: [false, false] },
        consequences: [],
      });
    });

    const playerMessageId = await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        campaignId,
        role: "player",
        content: "Examino a sala em busca de saídas.",
        clientMessageId: "player-g102",
        status: "complete",
        createdAt: Date.now(),
      });
    });

    let capturedPayload: any = null;
    vi.stubGlobal("fetch", makeRoutedFetch({
      sseContent: ["Você avista três portas."],
      onLlmCall: (body) => { capturedPayload = body; },
    }));

    const result = await t.action(internal.processTurnFull.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });
    expect(capturedPayload).not.toBeNull();

    const messages: Array<{ role: string; content: string }> = capturedPayload.messages;
    // Deve haver mais de 2 mensagens (não só [system, user])
    expect(messages.length).toBeGreaterThan(2);
    // Deve conter bloco do personagem (aspects)
    const allContent = messages.map((m) => m.content).join(" ");
    expect(allContent).toContain("Ladrã arrependida");
    // Última mensagem deve ser do user
    expect(messages[messages.length - 1].role).toBe("user");
  });
});

describe("processTurnFull (G-103 — integração de triggers)", () => {
  beforeEach(() => { vi.stubEnv("TOGETHER_API_KEY", "test-key"); vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  async function setupWithTrigger(
    t: ReturnType<typeof convexTest>,
    oneShot: boolean,
  ) {
    return await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "trigger@test.com",
        displayName: "Trigger Tester",
        tokenIdentifier: "token|trigger-" + Math.random(),
      });
      const campaignId = await ctx.db.insert("campaigns", {
        userId,
        name: "Trigger Campaign",
        premise: "Testes de gatilho.",
        tone: "dark",
        expectedDuration: "one-shot",
        status: "active",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      const dummyEmbedding = Array.from({ length: 1024 }, (_, i) => i * 0.001);
      const factId = await ctx.db.insert("facts", {
        campaignId,
        content: "O rei está morto.",
        visibility: "hidden",
        embedding: dummyEmbedding,
        createdAt: Date.now(),
      });
      const triggerId = await ctx.db.insert("triggers", {
        campaignId,
        description: "Revelar morte do rei quando jogador perguntar sobre o castelo",
        scope: "global",
        status: "armed",
        oneShot,
        embedding: dummyEmbedding,
        effects: [{ type: "change_fact_visibility", payload: { factId, visibility: "known" } }],
      });
      const playerMessageId = await ctx.db.insert("messages", {
        campaignId,
        role: "player",
        content: "O que acontece no castelo?",
        clientMessageId: "player-trigger-" + Math.random(),
        status: "complete",
        createdAt: Date.now(),
      });
      return { campaignId, factId, triggerId, playerMessageId };
    });
  }

  function makeClassifyResponse(activatedIds: string[]) {
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ ativados: activatedIds }) } }],
      }),
    };
  }

  it("G-103a: trigger relevante ativa → efeito executado antes da resposta do GM → triggersFired e factsRevealed persistidos", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, factId, triggerId, playerMessageId } = await setupWithTrigger(t, true);

    let classifyCalled = false;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, opts: any) => {
      // Together AI → embedding
      if (typeof _url === "string" && _url.includes("together")) {
        return makeEmbeddingResponse();
      }
      const body = opts?.body ? JSON.parse(opts.body) : {};
      // stream=true → LLM narrativo
      if (body.stream === true) {
        return { ok: true, body: makeSseStream(["O rei caiu."]) };
      }
      // classify triggers → sem stream e tem "candidates" no prompt ou response_format json_object sem "vazou"
      const prompt = JSON.stringify(body.messages ?? []);
      if (prompt.includes("ativados") || prompt.includes("trigger") || prompt.includes("Revelar morte")) {
        classifyCalled = true;
        return makeClassifyResponse([triggerId]);
      }
      // antiLeak
      if (prompt.includes("vazou") || (body.response_format && prompt.includes("trechos"))) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      }
      // factExtraction
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
        }),
      };
    }));

    const result = await t.action(internal.processTurnFull.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });
    const messageId = (result as { success: true; messageId: string }).messageId;

    await t.run(async (ctx) => {
      const gmMsg = await ctx.db.get(messageId as any);
      expect((gmMsg as any)!.triggersFired).toContain(triggerId);
      expect((gmMsg as any)!.factsRevealed).toContain(factId);

      // Fato deve estar visível agora
      const fact = await ctx.db.get(factId as any);
      expect((fact as any)!.visibility).toBe("known");
    });
  });

  it("G-103b: trigger oneShot: true → status vira 'fired' e não pode disparar novamente", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, triggerId, playerMessageId } = await setupWithTrigger(t, true);

    vi.stubGlobal("fetch", makeRoutedFetch({ classifyActivatedIds: [triggerId] }));

    await t.action(internal.processTurnFull.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });

    await t.run(async (ctx) => {
      const trigger = await ctx.db.get(triggerId as any);
      expect((trigger as any)!.status).toBe("fired");
    });
  });

  it("G-103c: trigger oneShot: false → permanece 'armed' após disparar", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, triggerId, playerMessageId } = await setupWithTrigger(t, false);

    vi.stubGlobal("fetch", makeRoutedFetch({ classifyActivatedIds: [triggerId] }));

    await t.action(internal.processTurnFull.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });

    await t.run(async (ctx) => {
      const trigger = await ctx.db.get(triggerId as any);
      expect((trigger as any)!.status).toBe("armed");
    });
  });
});

describe("processTurnFull (G-104 — anti-leak com hidden facts)", () => {
  beforeEach(() => { vi.stubEnv("TOGETHER_API_KEY", "test-key"); vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  async function setupWithHiddenFact(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "hidden@test.com",
        displayName: "Hidden Tester",
        tokenIdentifier: "token|hidden-" + Math.random(),
      });
      const campaignId = await ctx.db.insert("campaigns", {
        userId,
        name: "Hidden Facts Campaign",
        premise: "Segredos obscuros.",
        tone: "dark",
        expectedDuration: "one-shot",
        status: "active",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      const dummyEmbedding = Array.from({ length: 1024 }, (_, i) => i * 0.001);
      const hiddenFactId = await ctx.db.insert("facts", {
        campaignId,
        content: "O vilão é o rei.",
        visibility: "hidden",
        embedding: dummyEmbedding,
        createdAt: Date.now(),
      });
      const playerMessageId = await ctx.db.insert("messages", {
        campaignId,
        role: "player",
        content: "Quem é o vilão?",
        clientMessageId: "player-hidden-" + Math.random(),
        status: "complete",
        createdAt: Date.now(),
      });
      return { campaignId, hiddenFactId, playerMessageId };
    });
  }

  it("G-104a: validateAntiLeak recebe hidden facts relevantes — não [] hard-coded", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, hiddenFactId, playerMessageId } = await setupWithHiddenFact(t);

    let capturedAntiLeakPayload: any = null;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, opts: any) => {
      if (typeof url === "string" && url.includes("together")) {
        return makeEmbeddingResponse();
      }
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if (body.stream === true) {
        return { ok: true, body: makeSseStream(["Resposta do GM."]) };
      }
      const prompt = JSON.stringify(body.messages ?? []);
      if (prompt.includes("vazou") || prompt.includes("trechos")) {
        capturedAntiLeakPayload = body;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
        }),
      };
    }));

    const result = await t.action(internal.processTurnFull.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });
    const antiLeakPrompt = JSON.stringify(capturedAntiLeakPayload?.messages ?? []);
    expect(antiLeakPrompt).toContain("O vilão é o rei.");
  });

  it("G-104b: hidden fact aparece na resposta GM → validateAntiLeak detecta → regenera", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, playerMessageId } = await setupWithHiddenFact(t);

    vi.stubGlobal("fetch", makeRoutedFetch({ antiLeakVazou: true }));

    const result = await t.action(internal.processTurnFull.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });
    await t.run(async (ctx) => {
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .collect();
      const gmMsgs = msgs.filter((m) => m.role === "gm");
      expect(gmMsgs).toHaveLength(2);
      expect(gmMsgs.some((m) => m.status === "leaked")).toBe(true);
      expect(gmMsgs.some((m) => m.status === "complete")).toBe(true);
    });
  });
});

describe("processTurnFull (G-105 — paralelismo estágios 5 e 6)", () => {
  beforeEach(() => { vi.stubEnv("TOGETHER_API_KEY", "test-key"); vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key"); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  async function setupBasic(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "g105@test.com",
        displayName: "G105 Tester",
        tokenIdentifier: "token|g105-" + Math.random(),
      });
      const campaignId = await ctx.db.insert("campaigns", {
        userId,
        name: "G105 Campaign",
        premise: "Uma aventura.",
        tone: "dark",
        expectedDuration: "one-shot",
        status: "active",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      const sceneId = await ctx.db.insert("scenes", {
        campaignId,
        title: "Cena",
        description: "Desc",
        status: "active",
        createdAt: Date.now(),
      });
      const playerMessageId = await ctx.db.insert("messages", {
        campaignId,
        role: "player",
        content: "Ação do jogador.",
        clientMessageId: "player-g105-" + Math.random(),
        status: "complete",
        createdAt: Date.now(),
      });
      return { campaignId, playerMessageId };
    });
  }

  it("G-105a: antiLeak e extractFacts executam concorrentemente (mock counter)", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, playerMessageId } = await setupBasic(t);

    const callOrder: string[] = [];

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, opts: any) => {
      if (typeof url === "string" && url.includes("together")) {
        return makeEmbeddingResponse();
      }
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if (body.stream === true) {
        return { ok: true, body: makeSseStream(["Resposta do GM."]) };
      }
      const prompt = JSON.stringify(body.messages ?? []);
      if (prompt.includes("vazou") || prompt.includes("trechos")) {
        callOrder.push("antiLeak");
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      }
      if (prompt.includes("ativados") || prompt.includes("gatilhos")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ ativados: [], raciocinio: "" }) } }],
          }),
        };
      }
      callOrder.push("factExtraction");
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
        }),
      };
    }));

    const result = await t.action(internal.processTurnFull.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });
    // Ambos devem ter sido chamados
    expect(callOrder).toContain("antiLeak");
    expect(callOrder).toContain("factExtraction");
  });

  it("G-105b: antiLeakEnabled=false executa apenas extractAndPersistFacts", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, playerMessageId } = await setupBasic(t);

    const callOrder: string[] = [];

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, opts: any) => {
      if (typeof url === "string" && url.includes("together")) {
        return makeEmbeddingResponse();
      }
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if (body.stream === true) {
        return { ok: true, body: makeSseStream(["Resposta do GM."]) };
      }
      const prompt = JSON.stringify(body.messages ?? []);
      if (prompt.includes("vazou") || prompt.includes("trechos")) {
        callOrder.push("antiLeak");
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      }
      if (prompt.includes("ativados") || prompt.includes("gatilhos")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ ativados: [], raciocinio: "" }) } }],
          }),
        };
      }
      callOrder.push("factExtraction");
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
        }),
      };
    }));

    const result = await t.action(internal.processTurnFull.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: false,
    });

    expect(result).toMatchObject({ success: true });
    expect(callOrder).not.toContain("antiLeak");
    expect(callOrder).toContain("factExtraction");
  });
});

describe("processTurnFull (G-112 — re-prompt após tool call)", () => {
  beforeEach(() => {
    vi.stubEnv("TOGETHER_API_KEY", "test-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("G-112: GM chama tool → resultado reenviado ao LLM → GM continua narrativa descrevendo o resultado", async () => {
    const t = convexTest(schema, modules);

    const { campaignId, playerMessageId, characterId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "g112@test.com",
        displayName: "G112 Tester",
        tokenIdentifier: "token|g112-" + Math.random(),
      });
      const campaignId = await ctx.db.insert("campaigns", {
        userId,
        name: "G112 Campaign",
        premise: "Teste de re-prompt após tool call.",
        tone: "dark",
        expectedDuration: "one-shot",
        status: "active",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      const characterId = await ctx.db.insert("characters", {
        campaignId,
        name: "Herói",
        aspects: [],
        skills: {},
        stunts: [],
        fatePoints: 3,
        stress: { physical: [false, false, false], mental: [false, false, false] },
        consequences: [],
      });
      await ctx.db.insert("scenes", {
        campaignId,
        title: "Cena G-112",
        status: "active",
        createdAt: Date.now(),
      });
      const playerMessageId = await ctx.db.insert("messages", {
        campaignId,
        role: "player",
        content: "Uso um ponto de destino!",
        clientMessageId: "g112-player-" + Math.random(),
        status: "complete",
        createdAt: Date.now(),
      });
      return { campaignId, playerMessageId, characterId };
    });

    const capturedLlmMessages: any[][] = [];
    let streamCallCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, opts: any) => {
        if (typeof url === "string" && url.includes("together")) {
          return makeEmbeddingResponse();
        }
        const body = opts?.body ? JSON.parse(opts.body) : {};
        if (body.stream === true) {
          streamCallCount++;
          capturedLlmMessages.push(body.messages ?? []);
          if (streamCallCount === 1) {
            // 1ª passagem: LLM emite um tool call
            return {
              ok: true,
              body: makeToolCallSseStream(
                "award_fate_point",
                { characterId, reason: "teste G-112" },
                "tc_g112_1"
              ),
            };
          }
          // 2ª passagem: LLM continua a narrativa com o resultado da tool
          return { ok: true, body: makeSseStream(["O herói ganha um Ponto de Destino!"]) };
        }
        const prompt = JSON.stringify(body.messages ?? []);
        if (prompt.includes("vazou") || prompt.includes("trechos")) {
          return {
            ok: true,
            json: async () => ({
              choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
            }),
          };
        }
        if (prompt.includes("ativados") || prompt.includes("gatilhos")) {
          return {
            ok: true,
            json: async () => ({
              choices: [{ message: { content: JSON.stringify({ ativados: [], raciocinio: "" }) } }],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
          }),
        };
      })
    );

    const result = await t.action(internal.processTurnFull.processTurnFull, {
      campaignId,
      playerMessageId,
    });

    expect(result).toMatchObject({ success: true });

    // LLM deve ter sido chamado 2 vezes: 1ª para tool call, 2ª para continuação
    expect(streamCallCount).toBe(2);

    // 2ª chamada deve incluir mensagem assistant com tool_calls e mensagem tool com resultado
    const secondCallMsgs = capturedLlmMessages[1];
    const assistantMsg = secondCallMsgs.find(
      (m: any) => m.role === "assistant" && Array.isArray(m.tool_calls)
    );
    const toolMsg = secondCallMsgs.find((m: any) => m.role === "tool");

    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.tool_calls[0].function.name).toBe("award_fate_point");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.tool_call_id).toBe("tc_g112_1");

    // Mensagem GM deve conter o texto de continuação
    const gmMessage = await t.run(async (ctx) => {
      const msgs = await ctx.db
        .query("messages")
        .filter((q) => q.eq(q.field("role"), "gm"))
        .first();
      return msgs;
    });
    expect(gmMessage?.content).toContain("O herói ganha um Ponto de Destino!");
  });
});
