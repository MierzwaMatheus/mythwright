/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("validateAntiLeak", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function setupMessageAndGetId(t: ReturnType<typeof convexTest>, content: string) {
    return await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "test@test.com",
        displayName: "Test",
        tokenIdentifier: "token|antileak-test-" + Math.random(),
      });
      const campaignId = await ctx.db.insert("campaigns", {
        userId,
        name: "Test Campaign",
        premise: "Test",
        tone: "dark",
        expectedDuration: "one-shot",
        status: "active",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      const messageId = await ctx.db.insert("messages", {
        campaignId,
        role: "gm",
        content,
        clientMessageId: "msg-test-" + Math.random(),
        status: "complete",
      });
      return { messageId, campaignId };
    });
  }

  it("retorna { vazou: false, facts: [], trechos: [] } quando LLM responde sem vazamento", async () => {
    const t = convexTest(schema, modules);
    const { messageId, campaignId } = await setupMessageAndGetId(t, "O cavaleiro explorou a floresta.");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ vazou: false, facts: [], trechos: [] }) } }],
      }),
    }));

    const result = await t.action(internal.prompts.antiLeak.validateAntiLeak, {
      messageId,
      campaignId,
      hiddenFacts: [{ id: "fact_001", content: "O rei está morto." }],
    });

    expect(result).toEqual({ vazou: false, facts: [], trechos: [] });
  });

  it("retorna os dados de vazamento quando LLM detecta vazamento", async () => {
    const t = convexTest(schema, modules);
    const { messageId, campaignId } = await setupMessageAndGetId(t, "O rei já não governa mais esse reino.");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ vazou: true, facts: ["fact_001"], trechos: ["O rei já não governa mais esse reino."] }) } }],
      }),
    }));

    const result = await t.action(internal.prompts.antiLeak.validateAntiLeak, {
      messageId,
      campaignId,
      hiddenFacts: [{ id: "fact_001", content: "O rei está morto." }],
    });

    expect(result).toEqual({
      vazou: true,
      facts: ["fact_001"],
      trechos: ["O rei já não governa mais esse reino."],
    });
  });

  it("retorna { vazou: false, facts: [], trechos: [] } quando LLM retorna JSON malformado", async () => {
    const t = convexTest(schema, modules);
    const { messageId, campaignId } = await setupMessageAndGetId(t, "Texto qualquer.");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: "isso não é json válido { } {{{" } }],
      }),
    }));

    const result = await t.action(internal.prompts.antiLeak.validateAntiLeak, {
      messageId,
      campaignId,
      hiddenFacts: [{ id: "fact_001", content: "O rei está morto." }],
    });

    expect(result).toEqual({ vazou: false, facts: [], trechos: [] });
  });
});
