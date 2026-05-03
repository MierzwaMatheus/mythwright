/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildTriggerClassifierPrompt,
  parseTriggerClassifierResponse,
  TriggerCandidate,
} from "./prompts/triggerClassifier";
import { filterTriggerCandidates } from "../packages/fate-engine/src/index";
import { convexTest } from "convex-test";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// ─── buildTriggerClassifierPrompt ───────────────────────────────────────────

describe("buildTriggerClassifierPrompt", () => {
  const candidates: TriggerCandidate[] = [
    { id: "trigger_abc123", description: "o jogador menciona ou pergunta sobre Valdrik", scope: "cena_taverna" },
    { id: "trigger_def456", description: "o jogador investiga objetos suspeitos no porão", scope: "global" },
  ];

  it("inclui a mensagem do jogador no prompt", () => {
    const prompt = buildTriggerClassifierPrompt(
      "Eu pergunto ao taverneiro sobre Valdrik",
      "Uma taverna movimentada no centro da cidade",
      candidates,
    );
    expect(prompt).toContain("Eu pergunto ao taverneiro sobre Valdrik");
  });

  it("inclui o resumo da cena no prompt", () => {
    const prompt = buildTriggerClassifierPrompt(
      "Eu pergunto ao taverneiro sobre Valdrik",
      "Uma taverna movimentada no centro da cidade",
      candidates,
    );
    expect(prompt).toContain("Uma taverna movimentada no centro da cidade");
  });

  it("formata cada candidato com id e escopo no formato correto", () => {
    const prompt = buildTriggerClassifierPrompt(
      "Eu pergunto ao taverneiro sobre Valdrik",
      "Uma taverna movimentada no centro da cidade",
      candidates,
    );
    expect(prompt).toContain("[trigger_abc123] (escopo: cena_taverna)");
    expect(prompt).toContain("[trigger_def456] (escopo: global)");
    expect(prompt).toContain('"o jogador menciona ou pergunta sobre Valdrik"');
    expect(prompt).toContain('"o jogador investiga objetos suspeitos no porão"');
  });
});

// ─── parseTriggerClassifierResponse ─────────────────────────────────────────

describe("parseTriggerClassifierResponse", () => {
  it("retorna ids ativados quando há ativações no JSON", () => {
    const raw = JSON.stringify({
      ativados: ["trigger_abc123", "trigger_def456"],
      raciocinio: "O jogador perguntou sobre Valdrik diretamente.",
    });
    const result = parseTriggerClassifierResponse(raw);
    expect(result.ativados).toEqual(["trigger_abc123", "trigger_def456"]);
    expect(result.raciocinio).toBe("O jogador perguntou sobre Valdrik diretamente.");
  });

  it("retorna array vazio quando não há ativações", () => {
    const raw = JSON.stringify({
      ativados: [],
      raciocinio: "nenhum gatilho cabível",
    });
    const result = parseTriggerClassifierResponse(raw);
    expect(result.ativados).toEqual([]);
    expect(result.raciocinio).toBe("nenhum gatilho cabível");
  });

  it("tolera JSON inválido retornando ativados vazio e raciocinio vazio", () => {
    const result = parseTriggerClassifierResponse("isso não é json {{{");
    expect(result.ativados).toEqual([]);
    expect(result.raciocinio).toBe("");
  });
});

// ─── filterTriggerCandidates (fate-engine) ───────────────────────────────────

describe("filterTriggerCandidates", () => {
  it("filtra apenas triggers armed com scope global ou matching de cena", () => {
    const triggers = [
      { id: "t1", status: "armed" as const, scope: "global" },
      { id: "t2", status: "armed" as const, scope: "cena_taverna" },
      { id: "t3", status: "armed" as const, scope: "cena_dungeon" },
      { id: "t4", status: "disabled" as const, scope: "global" },
      { id: "t5", status: "fired" as const, scope: "cena_taverna" },
    ];
    const result = filterTriggerCandidates(triggers, "cena_taverna");
    expect(result.map((t) => t.id)).toEqual(["t1", "t2"]);
  });
});

// ─── classifyTriggers (integração com mock LLM) ──────────────────────────────

describe("classifyTriggers", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("retorna activatedIds corretos quando LLM ativa gatilhos", async () => {
    const t = convexTest(schema, modules);

    const campaignId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "test@test.com",
        displayName: "GM",
        tokenIdentifier: "token|test001",
      });
      return ctx.db.insert("campaigns", {
        userId,
        name: "Test Campaign",
        premise: "Teste",
        tone: "dark",
        expectedDuration: "medium",
        status: "setup",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
    });

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                ativados: ["trigger_abc123"],
                raciocinio: "O jogador perguntou sobre Valdrik.",
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    const result = await t.action(internal.classifyTriggers.classifyTriggers, {
      campaignId,
      playerMessage: "Eu pergunto ao taverneiro sobre Valdrik",
      sceneSummary: "Uma taverna movimentada",
      candidates: [
        { id: "trigger_abc123", description: "o jogador menciona Valdrik", scope: "global" },
      ],
    });

    expect(result.activatedIds).toEqual(["trigger_abc123"]);
  });

  it("retorna activatedIds vazio quando LLM não ativa nenhum gatilho", async () => {
    const t = convexTest(schema, modules);

    const campaignId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "test2@test.com",
        displayName: "GM2",
        tokenIdentifier: "token|test002",
      });
      return ctx.db.insert("campaigns", {
        userId,
        name: "Test Campaign 2",
        premise: "Teste",
        tone: "dark",
        expectedDuration: "medium",
        status: "setup",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
    });

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                ativados: [],
                raciocinio: "nenhum gatilho cabível",
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);

    const result = await t.action(internal.classifyTriggers.classifyTriggers, {
      campaignId,
      playerMessage: "Eu olho ao redor da taverna",
      sceneSummary: "Uma taverna movimentada",
      candidates: [
        { id: "trigger_abc123", description: "o jogador menciona Valdrik", scope: "global" },
      ],
    });

    expect(result.activatedIds).toEqual([]);
  });
});
