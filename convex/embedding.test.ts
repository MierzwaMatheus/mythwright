/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function makeFakeEmbedding(size = 1024): number[] {
  return Array.from({ length: size }, (_, i) => i * 0.001);
}

function mockFetch(embedding: number[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [{ embedding }],
    }),
  });
}

describe("generateEmbedding", () => {
  beforeEach(() => {
    vi.stubEnv("TOGETHER_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("retorna array com 1024 elementos", async () => {
    const t = convexTest(schema, modules);
    const fakeEmbedding = makeFakeEmbedding(1024);
    vi.stubGlobal("fetch", mockFetch(fakeEmbedding));

    const result = await t.action(internal.lib.embedding.generateEmbedding, {
      text: "Texto de teste",
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1024);
  });

  it("chama a URL correta da Together AI API", async () => {
    const t = convexTest(schema, modules);
    const fakeEmbedding = makeFakeEmbedding(1024);
    const fakeFetch = mockFetch(fakeEmbedding);
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.lib.embedding.generateEmbedding, {
      text: "Texto de teste",
    });

    expect(fakeFetch).toHaveBeenCalledOnce();
    const [url, options] = fakeFetch.mock.calls[0];
    expect(url).toBe("https://api.together.xyz/v1/embeddings");
    const body = JSON.parse(options.body);
    expect(body.input).toBe("Texto de teste");
    expect(body.model).toBe("BAAI/bge-m3");
  });

  it("aceita model custom e o envia para a API", async () => {
    const t = convexTest(schema, modules);
    const fakeEmbedding = makeFakeEmbedding(1024);
    const fakeFetch = mockFetch(fakeEmbedding);
    vi.stubGlobal("fetch", fakeFetch);

    await t.action(internal.lib.embedding.generateEmbedding, {
      text: "Texto de teste",
      model: "openai/text-embedding-3-small",
    });

    const [, options] = fakeFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.model).toBe("openai/text-embedding-3-small");
  });

  it("lanca erro claro quando API retorna embedding com dimensao errada", async () => {
    const t = convexTest(schema, modules);
    const fakeEmbedding = makeFakeEmbedding(512); // dimensao errada
    vi.stubGlobal("fetch", mockFetch(fakeEmbedding));

    await expect(
      t.action(internal.lib.embedding.generateEmbedding, { text: "Texto de teste" }),
    ).rejects.toThrow("Embedding dimension mismatch: expected 1024, got 512");
  });
});

describe("embedFact", () => {
  beforeEach(() => {
    vi.stubEnv("TOGETHER_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function setupUserCampaignFact(t: ReturnType<typeof convexTest>) {
    // Usa runMutation direto para criar user/campaign/fact sem auth
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "embed@test.com",
        displayName: "GM",
        tokenIdentifier: "token|embed001",
      });
    });
    const campaignId = await t.run(async (ctx) => {
      return await ctx.db.insert("campaigns", {
        userId,
        name: "Campanha Embed",
        premise: "Teste de embedding",
        tone: "dark",
        expectedDuration: "medium",
        status: "setup",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
    });
    const factId = await t.run(async (ctx) => {
      return await ctx.db.insert("facts", {
        campaignId,
        content: "O rei está morto",
        visibility: "hidden",
      });
    });
    return { userId, campaignId, factId };
  }

  it("persiste embedding no fact após embedFact", async () => {
    const t = convexTest(schema, modules);
    const { factId } = await setupUserCampaignFact(t);
    const fakeEmbedding = makeFakeEmbedding(1024);
    vi.stubGlobal("fetch", mockFetch(fakeEmbedding));

    await t.action(internal.lib.embedding.embedFact, { factId });

    const fact = await t.run(async (ctx) => ctx.db.get(factId));
    expect(fact?.embedding).toHaveLength(1024);
    expect(fact?.embedding).toEqual(fakeEmbedding);
  });

  it("usa embeddingModel da campanha quando diferente do default", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, factId } = await setupUserCampaignFact(t);
    const fakeEmbedding = makeFakeEmbedding(1024);
    const fakeFetch = mockFetch(fakeEmbedding);
    vi.stubGlobal("fetch", fakeFetch);

    // Configura campanha com modelo customizado
    await t.run(async (ctx) => {
      await ctx.db.patch(campaignId, {
        llmConfig: {
          narrativeModel: "deepseek/deepseek-chat-v3-0324",
          utilityModel: "meta-llama/llama-3.1-8b-instruct",
          extractionModel: "meta-llama/llama-3.1-8b-instruct",
          embeddingModel: "openai/text-embedding-3-small",
        },
      });
    });

    await t.action(internal.lib.embedding.embedFact, { factId });

    const [, options] = fakeFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.model).toBe("openai/text-embedding-3-small");
  });
});

describe("embedEntity", () => {
  beforeEach(() => {
    vi.stubEnv("TOGETHER_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("persiste embedding na entity após embedEntity", async () => {
    const t = convexTest(schema, modules);
    const fakeEmbedding = makeFakeEmbedding(1024);
    vi.stubGlobal("fetch", mockFetch(fakeEmbedding));

    const entityId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "ee@test.com",
        displayName: "GM",
        tokenIdentifier: "token|ee001",
      });
      const campaignId = await ctx.db.insert("campaigns", {
        userId,
        name: "C",
        premise: "P",
        tone: "T",
        expectedDuration: "medium",
        status: "setup",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      return await ctx.db.insert("entities", {
        campaignId,
        type: "npc",
        name: "Aragorn",
        visibility: "known",
        description: "Um ranger do norte",
      });
    });

    await t.action(internal.lib.embedding.embedEntity, { entityId });

    const entity = await t.run(async (ctx) => ctx.db.get(entityId));
    expect(entity?.embedding).toHaveLength(1024);
  });
});

describe("embedTrigger", () => {
  beforeEach(() => {
    vi.stubEnv("TOGETHER_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("persiste embedding no trigger após embedTrigger", async () => {
    const t = convexTest(schema, modules);
    const fakeEmbedding = makeFakeEmbedding(1024);
    vi.stubGlobal("fetch", mockFetch(fakeEmbedding));

    const triggerId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "et@test.com",
        displayName: "GM",
        tokenIdentifier: "token|et001",
      });
      const campaignId = await ctx.db.insert("campaigns", {
        userId,
        name: "C",
        premise: "P",
        tone: "T",
        expectedDuration: "medium",
        status: "setup",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      return await ctx.db.insert("triggers", {
        campaignId,
        description: "Quando o rei morrer",
        scope: "global",
        effects: [],
        status: "armed",
        oneShot: false,
      });
    });

    await t.action(internal.lib.embedding.embedTrigger, { triggerId });

    const trigger = await t.run(async (ctx) => ctx.db.get(triggerId));
    expect(trigger?.embedding).toHaveLength(1024);
  });
});

describe("embedMessage", () => {
  beforeEach(() => {
    vi.stubEnv("TOGETHER_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function setupUserCampaignMessage(
    t: ReturnType<typeof convexTest>,
    role: "player" | "gm" | "system" = "player",
  ) {
    return await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "emsg@test.com",
        displayName: "GM",
        tokenIdentifier: "token|emsg001",
      });
      const campaignId = await ctx.db.insert("campaigns", {
        userId,
        name: "C",
        premise: "P",
        tone: "T",
        expectedDuration: "medium",
        status: "setup",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      const messageId = await ctx.db.insert("messages", {
        campaignId,
        role,
        content: "Eu ataco o goblin",
        clientMessageId: "test-client-id",
        status: "pending",
      });
      return { userId, campaignId, messageId };
    });
  }

  it("persiste embedding na mensagem após embedMessage", async () => {
    const t = convexTest(schema, modules);
    const { messageId } = await setupUserCampaignMessage(t);
    const fakeEmbedding = makeFakeEmbedding(1024);
    vi.stubGlobal("fetch", mockFetch(fakeEmbedding));

    await t.action(internal.lib.embedding.embedMessage, { messageId, content: "Eu ataco o goblin" });

    const msg = await t.run(async (ctx) => ctx.db.get(messageId));
    expect(msg?.embedding).toHaveLength(1024);
    expect(msg?.embedding).toEqual(fakeEmbedding);
  });

  it("createMessage agenda embedding para mensagem do player", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fakeEmbedding = makeFakeEmbedding(1024);
    vi.stubGlobal("fetch", mockFetch(fakeEmbedding));

    const { campaignId } = await setupUserCampaignMessage(t);

    const messageId = await t.mutation(api.messages.createMessage, {
      campaignId,
      role: "player",
      content: "Eu examino a porta",
      clientMessageId: "new-player-msg",
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    vi.useRealTimers();

    const msg = await t.run(async (ctx) => ctx.db.get(messageId as Id<"messages">));
    expect(msg?.embedding).toHaveLength(1024);
  });

  it("createMessage NÃO agenda embedding para mensagem do gm", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fakeEmbedding = makeFakeEmbedding(1024);
    const fakeFetch = mockFetch(fakeEmbedding);
    vi.stubGlobal("fetch", fakeFetch);

    const { campaignId } = await setupUserCampaignMessage(t);

    const messageId = await t.mutation(api.messages.createMessage, {
      campaignId,
      role: "gm",
      content: "O GM responde",
      clientMessageId: "gm-msg-no-embed",
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    vi.useRealTimers();

    const msg = await t.run(async (ctx) => ctx.db.get(messageId as Id<"messages">));
    expect(msg?.embedding).toBeUndefined();
  });
});
