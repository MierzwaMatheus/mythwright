/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const DUMMY_EMBEDDING = Array.from({ length: 1024 }, (_, i) => i * 0.001);

function makeEmbeddingResponse() {
  return {
    ok: true,
    json: async () => ({
      data: [{ embedding: DUMMY_EMBEDDING }],
    }),
  };
}

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

// Seed completo: user + campaign + character + scene + facts + entity + trigger + player message
// hiddenFactTrigger: revelado pelo trigger (change_fact_visibility)
// hiddenFactAntileak: fato hidden separado, não afetado pelo trigger → aparece no prompt anti-leak
async function setupFullSeed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "e2e@test.com",
      displayName: "E2E Tester",
      tokenIdentifier: "token|e2e-" + Math.random(),
    });

    const campaignId = await ctx.db.insert("campaigns", {
      userId,
      name: "E2E Campaign",
      premise: "Uma aventura completa para o teste E2E.",
      tone: "dark",
      expectedDuration: "one-shot",
      status: "active",
      setupStatus: "ready",
      antiLeakValidationEnabled: true,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    });

    await ctx.db.insert("characters", {
      campaignId,
      name: "Kael",
      aspects: ["Guerreiro endurecido", "Dívida de sangue"],
      skills: { Luta: 3, Vigor: 2, Vontade: 2 },
      stunts: ["Golpe Preciso"],
      fatePoints: 3,
      stress: { physical: [false, false, false], mental: [false, false] },
      consequences: [],
    });

    const sceneId = await ctx.db.insert("scenes", {
      campaignId,
      title: "O Forte em Ruínas",
      description: "Um forte abandonado envolto em névoa.",
      status: "active",
      createdAt: Date.now(),
    });

    await ctx.db.patch(campaignId, { currentSceneId: sceneId });

    await ctx.db.insert("facts", {
      campaignId,
      content: "O forte foi construído pelos antigos.",
      visibility: "known",
      embedding: DUMMY_EMBEDDING,
      createdAt: Date.now(),
    });

    // Fato hidden alvo do trigger (será revelado antes do anti-leak)
    const hiddenFactTrigger = await ctx.db.insert("facts", {
      campaignId,
      content: "O comandante do forte ainda vive nas ruínas.",
      visibility: "hidden",
      embedding: DUMMY_EMBEDDING,
      createdAt: Date.now(),
    });

    // Fato hidden separado — não afetado pelo trigger → estará presente no prompt anti-leak
    const hiddenFactAntileak = await ctx.db.insert("facts", {
      campaignId,
      content: "A senha secreta do cofre é 'sombra'.",
      visibility: "hidden",
      embedding: DUMMY_EMBEDDING,
      createdAt: Date.now(),
    });

    await ctx.db.insert("entities", {
      campaignId,
      type: "location",
      name: "Forte em Ruínas",
      visibility: "known",
      description: "Um forte de pedra em decadência.",
      embedding: DUMMY_EMBEDDING,
    });

    const triggerId = await ctx.db.insert("triggers", {
      campaignId,
      description: "Revelar o comandante quando jogador explorar o forte",
      scope: "global",
      status: "armed",
      oneShot: true,
      embedding: DUMMY_EMBEDDING,
      effects: [{ type: "change_fact_visibility", payload: { factId: hiddenFactTrigger, visibility: "known" } }],
    });

    const playerMessageId = await ctx.db.insert("messages", {
      campaignId,
      sceneId,
      role: "player",
      content: "Exploro o forte em busca de sinais de vida.",
      clientMessageId: "player-e2e-" + Math.random(),
      status: "complete",
      createdAt: Date.now(),
    });

    return { userId, campaignId, sceneId, hiddenFactTrigger, hiddenFactAntileak, triggerId, playerMessageId };
  });
}

describe("G-119 — Teste E2E completo do processTurnFull", () => {
  beforeEach(() => {
    vi.stubEnv("TOGETHER_API_KEY", "test-together-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fluxo completo: mensagem GM persistida com content correto, triggersFired, factsRevealed e embedding agendado", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, hiddenFactTrigger, triggerId, playerMessageId } =
      await setupFullSeed(t);

    let capturedAuthHeader: string | undefined;

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, opts: any) => {
      if (typeof url === "string" && url.includes("together")) {
        return makeEmbeddingResponse();
      }
      const body = opts?.body ? JSON.parse(opts.body) : {};
      const headers: Record<string, string> = opts?.headers ?? {};

      if (body.stream === true) {
        capturedAuthHeader = headers["Authorization"] ?? headers["authorization"];
        return { ok: true, body: makeSseStream(["Texto inicial. ", "Texto final."]) };
      }

      const prompt = JSON.stringify(body.messages ?? []);

      if (prompt.includes("ativados") || prompt.includes("gatilhos")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ ativados: [triggerId], raciocinio: "exploração relevante" }) } }],
          }),
        };
      }

      if (prompt.includes("vazou") || prompt.includes("trechos")) {
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

    const result = await t.action(internal.processTurn.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });

    // Retorno deve ser sucesso
    expect(result).toMatchObject({ success: true });
    const messageId = (result as { success: true; messageId: string }).messageId;

    await t.run(async (ctx) => {
      const gmMsg = await ctx.db.get(messageId as any);
      expect(gmMsg).not.toBeNull();

      // Mensagem GM persistida corretamente
      expect((gmMsg as any).status).toBe("complete");
      expect((gmMsg as any).causedByMessageId).toBe(playerMessageId);
      expect((gmMsg as any).content).toContain("Texto inicial.");
      expect((gmMsg as any).content).toContain("Texto final.");
      expect((gmMsg as any).finalizedAt).toBeDefined();

      // triggersFired e factsRevealed
      expect((gmMsg as any).triggersFired).toContain(triggerId);
      expect((gmMsg as any).factsRevealed).toContain(hiddenFactTrigger);

      // Fato hidden deve ter sido revelado pelo trigger
      const revealedFact = await ctx.db.get(hiddenFactTrigger as any);
      expect((revealedFact as any).visibility).toBe("known");
    });

    // Embedding da mensagem GM agendado
    await t.run(async (ctx) => {
      const scheduled = await ctx.db.system.query("_scheduled_functions").collect();
      const embedScheduled = scheduled.some(
        (s: any) => s.name === "lib/embedding:embedMessage"
      );
      expect(embedScheduled).toBe(true);
    });

    // BYOK: header Authorization presente na chamada ao LLM narrativo (via env fallback)
    expect(capturedAuthHeader).toBeDefined();
    expect(capturedAuthHeader).toMatch(/^Bearer /);
  });

  it("idempotência: segunda chamada com mesmo playerMessageId retorna o mesmo messageId sem criar nova mensagem GM", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, triggerId, playerMessageId } = await setupFullSeed(t);

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, opts: any) => {
      if (typeof url === "string" && url.includes("together")) {
        return makeEmbeddingResponse();
      }
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if (body.stream === true) {
        return { ok: true, body: makeSseStream(["Resposta idempotente."]) };
      }
      const prompt = JSON.stringify(body.messages ?? []);
      if (prompt.includes("ativados") || prompt.includes("gatilhos")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ ativados: [triggerId], raciocinio: "" }) } }],
          }),
        };
      }
      if (prompt.includes("vazou") || prompt.includes("trechos")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ facts: [] }) } }] }),
      };
    }));

    const result1 = await t.action(internal.processTurn.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });
    expect(result1).toMatchObject({ success: true });
    const messageId1 = (result1 as { success: true; messageId: string }).messageId;

    const result2 = await t.action(internal.processTurn.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });
    expect(result2).toMatchObject({ success: true });
    const messageId2 = (result2 as { success: true; messageId: string }).messageId;

    expect(messageId2).toBe(messageId1);

    await t.run(async (ctx) => {
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .collect();
      const gmMsgs = msgs.filter((m: any) => m.role === "gm");
      expect(gmMsgs).toHaveLength(1);
    });
  });

  it("hidden facts no anti-leak: fato oculto não-revelado pelo trigger é passado para validateAntiLeak", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, hiddenFactAntileak, triggerId, playerMessageId } =
      await setupFullSeed(t);

    let antiLeakPromptContent = "";

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, opts: any) => {
      if (typeof url === "string" && url.includes("together")) {
        return makeEmbeddingResponse();
      }
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if (body.stream === true) {
        return { ok: true, body: makeSseStream(["Resposta do GM."]) };
      }
      const prompt = JSON.stringify(body.messages ?? []);
      if (prompt.includes("ativados") || prompt.includes("gatilhos")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ ativados: [triggerId], raciocinio: "" }) } }],
          }),
        };
      }
      if (prompt.includes("vazou") || prompt.includes("trechos")) {
        antiLeakPromptContent = prompt;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ facts: [] }) } }] }),
      };
    }));

    const result = await t.action(internal.processTurn.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });

    // O fato hidden separado (não revelado pelo trigger) deve aparecer no prompt anti-leak
    await t.run(async (ctx) => {
      const fact = await ctx.db.get(hiddenFactAntileak as any);
      expect((fact as any).visibility).toBe("hidden");
    });
    expect(antiLeakPromptContent).toContain("sombra");
  });

  it("paralelismo (estágios 5/6): fluxo completo termina com sucesso sem timeout quando há retrieval paralelo", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, triggerId, playerMessageId } = await setupFullSeed(t);

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, opts: any) => {
      if (typeof url === "string" && url.includes("together")) {
        return makeEmbeddingResponse();
      }
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if (body.stream === true) {
        return { ok: true, body: makeSseStream(["O forte guarda segredos."]) };
      }
      const prompt = JSON.stringify(body.messages ?? []);
      if (prompt.includes("ativados") || prompt.includes("gatilhos")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ ativados: [triggerId], raciocinio: "" }) } }],
          }),
        };
      }
      if (prompt.includes("vazou") || prompt.includes("trechos")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ facts: [] }) } }] }),
      };
    }));

    const result = await t.action(internal.processTurn.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: true,
    });

    expect(result).toMatchObject({ success: true });
  });
});
