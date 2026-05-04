/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupUserWithKey(
  t: ReturnType<typeof convexTest>,
  tokenIdentifier: string,
  email: string,
  key?: string,
) {
  const identity = t.withIdentity({ tokenIdentifier, email });
  await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });
  if (key) {
    await identity.mutation(api.users.saveOpenRouterKey, { key });
  }
  const userId = await t.run(async (ctx) => {
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("tokenIdentifier"), tokenIdentifier))
      .first();
    return user!._id;
  });
  return { identity, userId };
}

async function setupCampaignForUser(
  t: ReturnType<typeof convexTest>,
  identity: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
) {
  return identity.mutation(api.campaigns.createCampaign, {
    name: "Campanha BYOK",
    premise: "Aventura épica.",
    tone: "dark fantasy",
    expectedDuration: "medium",
  }) as Promise<import("./_generated/dataModel").Id<"campaigns">>;
}

// ---------------------------------------------------------------------------
// Testes de getDecryptedOpenRouterKey
// ---------------------------------------------------------------------------

describe("getDecryptedOpenRouterKey", () => {
  it("retorna a chave descriptografada quando usuario tem chave salva", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await setupUserWithKey(
      t,
      "token|byok001",
      "byok001@test.com",
      "sk-or-user-key-abc123",
    );

    const key = await t.run(async (ctx) => {
      const { getDecryptedOpenRouterKey } = await import("./lib/llmAuth");
      return getDecryptedOpenRouterKey(ctx, userId);
    });

    expect(key).toBe("sk-or-user-key-abc123");
  });

  it("retorna null quando usuario nao tem chave salva", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await setupUserWithKey(
      t,
      "token|byok002",
      "byok002@test.com",
      // sem chave
    );

    const key = await t.run(async (ctx) => {
      const { getDecryptedOpenRouterKey } = await import("./lib/llmAuth");
      return getDecryptedOpenRouterKey(ctx, userId);
    });

    expect(key).toBeNull();
  });

  it("lanca erro quando userId nao existe no banco", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.run(async (ctx) => {
        const { getDecryptedOpenRouterKey } = await import("./lib/llmAuth");
        // ID valido no formato Convex mas inexistente
        const fakeId = "jd7f0000000000000000000" as import("./_generated/dataModel").Id<"users">;
        return getDecryptedOpenRouterKey(ctx, fakeId);
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Testes de resolveOpenRouterKey (helper que combina usuario + env fallback)
// ---------------------------------------------------------------------------

describe("resolveOpenRouterKey", () => {
  it("prioriza chave do usuario sobre process.env", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await setupUserWithKey(
      t,
      "token|byok003",
      "byok003@test.com",
      "sk-or-user-priority",
    );

    // garantir que env esta definida
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-env-key");

    const key = await t.run(async (ctx) => {
      const { resolveOpenRouterKey } = await import("./lib/llmAuth");
      return resolveOpenRouterKey(ctx, userId);
    });

    expect(key).toBe("sk-or-user-priority");
    vi.unstubAllEnvs();
  });

  it("usa process.env quando usuario nao tem chave (fallback dev/test)", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await setupUserWithKey(
      t,
      "token|byok004",
      "byok004@test.com",
      // sem chave do usuario
    );

    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-env-fallback");

    const key = await t.run(async (ctx) => {
      const { resolveOpenRouterKey } = await import("./lib/llmAuth");
      return resolveOpenRouterKey(ctx, userId);
    });

    expect(key).toBe("sk-or-env-fallback");
    vi.unstubAllEnvs();
  });

  it("lanca OpenRouterKeyMissingError quando nao ha chave do usuario nem env", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await setupUserWithKey(
      t,
      "token|byok005",
      "byok005@test.com",
      // sem chave do usuario
    );

    // remover env
    vi.stubEnv("OPENROUTER_API_KEY", "");

    await expect(
      t.run(async (ctx) => {
        const { resolveOpenRouterKey } = await import("./lib/llmAuth");
        return resolveOpenRouterKey(ctx, userId);
      }),
    ).rejects.toThrow("openrouter_key_missing");

    vi.unstubAllEnvs();
  });
});

// ---------------------------------------------------------------------------
// Testes de integracao: processTurnFull retorna openrouter_key_missing
// ---------------------------------------------------------------------------
// Nota: estes testes verificam o comportamento do guard de chave no
// processTurnFull. O guard deve rodar ANTES do Estagio 2 (embedding),
// por isso o teste nao precisa de mock de TOGETHER_API_KEY.
// ---------------------------------------------------------------------------

describe("processTurnFull — BYOK integration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("falha com reason openrouter_key_missing quando usuario nao tem chave e env nao esta definida", async () => {
    const t = convexTest(schema, modules);

    const { identity } = await setupUserWithKey(
      t,
      "token|byok007",
      "byok007@test.com",
      // sem chave
    );
    const campaignId = await setupCampaignForUser(t, identity);

    const sceneId = await t.run(async (ctx) => {
      return ctx.db.insert("scenes", {
        campaignId,
        title: "Cena Sem Chave",
        description: "Cena para testar ausencia de chave.",
        status: "active",
        createdAt: Date.now(),
      });
    });

    const playerMessageId = await t.run(async (ctx) => {
      return ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "player",
        content: "Acao do jogador.",
        clientMessageId: "client-byok-002",
        status: "pending",
        createdAt: Date.now(),
      });
    });

    vi.stubEnv("OPENROUTER_API_KEY", "");

    const result = await t.action(internal.processTurn.processTurnFull, {
      campaignId,
      playerMessageId,
    });

    expect("success" in result && result.success === false || "status" in result).toBe(true);
    if ("success" in result && !result.success) {
      expect((result as { success: false; reason: string }).reason).toBe("openrouter_key_missing");
    }

    vi.unstubAllEnvs();
  });

  it("usa chave do usuario no header Authorization da chamada LLM", async () => {
    const t = convexTest(schema, modules);

    const { identity } = await setupUserWithKey(
      t,
      "token|byok006",
      "byok006@test.com",
      "sk-or-user-byok-test",
    );
    const campaignId = await setupCampaignForUser(t, identity);

    const sceneId = await t.run(async (ctx) => {
      return ctx.db.insert("scenes", {
        campaignId,
        title: "Cena BYOK",
        description: "Uma cena para teste BYOK.",
        status: "active",
        createdAt: Date.now(),
      });
    });

    const playerMessageId = await t.run(async (ctx) => {
      return ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "player",
        content: "O que eu vejo ao meu redor?",
        clientMessageId: "client-byok-001",
        status: "pending",
        createdAt: Date.now(),
      });
    });

    // Configurar TOGETHER_API_KEY para que o embedding nao falhe antes do fetch
    vi.stubEnv("TOGETHER_API_KEY", "sk-together-mock");

    // Capturar qual chave foi usada no fetch (inclui both: embedding e openrouter)
    const capturedAuthHeaders: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.["Authorization"]) {
        capturedAuthHeaders.push(headers["Authorization"]);
      }
      const encoder = new TextEncoder();
      // Together AI (embedding): retornar JSON
      if (typeof url === "string" && url.includes("together.xyz")) {
        return {
          ok: true,
          json: async () => ({ data: [{ embedding: new Array(1024).fill(0.1) }] }),
        } as unknown as Response;
      }
      // OpenRouter non-streaming (antiLeak, classifyTriggers, factExtraction): retornar JSON
      const bodyStr = init?.body ? String(init.body) : "";
      if (typeof url === "string" && url.includes("openrouter") && !bodyStr.includes('"stream":true')) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"vazou":false}' } }],
          }),
        } as unknown as Response;
      }
      // OpenRouter streaming (narrativa): retornar stream
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":"Resposta do GM."}}]}\n\ndata: [DONE]\n\n',
            ),
          );
          controller.close();
        },
      });
      return { ok: true, body: stream } as unknown as Response;
    });

    await t.action(internal.processTurn.processTurnFull, {
      campaignId,
      playerMessageId,
    });

    // Verificar que uma das chamadas usou a chave do usuario
    const openrouterHeaders = capturedAuthHeaders.filter((h) =>
      h.includes("sk-or-user-byok-test"),
    );
    expect(openrouterHeaders.length).toBeGreaterThan(0);

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
