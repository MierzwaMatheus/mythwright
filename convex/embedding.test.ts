/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { internal } from "./_generated/api";
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
