/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";
import { seedReadyCampaign } from "./_testHelpers";

const modules = import.meta.glob("./**/*.ts");

function makeStream(chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(enc.encode(chunk));
      }
      controller.close();
    },
  });
}

function textStream(content: string) {
  return makeStream([
    `data: {"choices":[{"delta":{"content":"${content}"}}]}\n\n`,
    `data: [DONE]\n\n`,
  ]);
}

function compelAspectStream(aspectId: string, characterId: string) {
  const args = JSON.stringify({ aspectId, characterId, complication: "Você deve fugir" })
    .replace(/"/g, '\\"');
  return makeStream([
    `data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"compel_aspect","arguments":"${args}"}}]}}]}\n\n`,
    `data: [DONE]\n\n`,
  ]);
}

async function setupBase(t: ReturnType<typeof convexTest>) {
  const identity = t.withIdentity({ tokenIdentifier: "token|cac001", email: "cac001@test.com" });
  await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });
  const campaignId = await seedReadyCampaign(t, identity, {
    name: "Campanha Compel",
    premise: "Aventura épica",
    tone: "dark",
    expectedDuration: "medium",
  });
  const sceneId = await identity.mutation(api.scenes.createScene, {
    campaignId,
    title: "Cena inicial",
  }) as Id<"scenes">;
  await identity.mutation(api.scenes.updateSceneStatus, { sceneId, status: "active" });
  const characterId = await identity.mutation(api.characters.createCharacter, {
    campaignId,
    name: "Herói",
    aspects: ["Corajoso"],
    skills: {},
    stunts: [],
    fatePoints: 3,
    stress: { physical: [false, false], mental: [false, false] },
  }) as Id<"characters">;
  const aspectId = await identity.mutation(api.sceneAspects.addSceneAspect, {
    sceneId,
    text: "Em chamas",
    freeInvokes: 1,
  }) as Id<"sceneAspects">;

  let playerMessageId: Id<"messages">;
  await t.run(async (ctx) => {
    playerMessageId = await ctx.db.insert("messages", {
      campaignId,
      sceneId,
      role: "player",
      content: "Eu avanço para o inimigo",
      clientMessageId: "client-cac001",
      status: "complete",
      createdAt: Date.now(),
    });
  });

  return { identity, campaignId, sceneId, characterId, aspectId, playerMessageId: playerMessageId! };
}

// --- Ciclo 3: processTurnFull passa IDs ao beginCompelInternal ---

describe("processTurnFull — compel_aspect persiste triggeringMessageId e pausedGmMessageId", () => {
  beforeEach(() => {
    vi.stubEnv("TOGETHER_API_KEY", "test-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("compel no banco tem triggeringMessageId e pausedGmMessageId após awaiting_player_decision", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, aspectId, characterId, playerMessageId } = await setupBase(t);

    // 1ª chamada: embedding (Together AI)
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: Array.from({ length: 1024 }, (_, i) => i * 0.001) }] }),
    });
    // 2ª chamada: narrative LLM com compel_aspect tool call
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: compelAspectStream(aspectId, characterId),
    });

    const result = await t.action(internal.processTurn.processTurnFull, {
      campaignId,
      playerMessageId,
      antiLeakValidationEnabled: false,
    });

    expect(result).toMatchObject({ status: "awaiting_player_decision" });
    const { compelId } = result as { status: string; compelId: Id<"compels">; messageId: Id<"messages"> };

    await t.run(async (ctx) => {
      const compel = await ctx.db.get(compelId);
      expect(compel!.triggeringMessageId).toBe(playerMessageId);
      expect(compel!.pausedGmMessageId).toBeDefined();
    });
  });
});

// --- Ciclo 4: continueAfterCompel internalAction ---

describe("continueAfterCompel", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("compel accepted — appenda compel_resolution, chama LLM, retorna success", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, sceneId, characterId, aspectId, playerMessageId } = await setupBase(t);

    let gmMessageId: Id<"messages">;
    let compelId: Id<"compels">;
    await t.run(async (ctx) => {
      gmMessageId = await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "gm",
        content: "Texto parcial antes do compel",
        clientMessageId: "gm-cac002",
        status: "pending",
        createdAt: Date.now(),
        causedByMessageId: playerMessageId,
      });
      compelId = await ctx.db.insert("compels", {
        campaignId,
        aspectId,
        characterId,
        complication: "Você deve fugir",
        status: "accepted",
        createdAt: Date.now(),
        resolvedAt: Date.now(),
        triggeringMessageId: playerMessageId,
        pausedGmMessageId: gmMessageId,
      });
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: textStream("Continuação da narrativa após compel"),
    });

    const result = await t.action(internal.processTurn.continueAfterCompel, {
      playerMessageId,
      gmMessageId: gmMessageId!,
      compelId: compelId!,
    });

    expect(result).toMatchObject({ success: true, messageId: gmMessageId! });

    await t.run(async (ctx) => {
      const msg = await ctx.db.get(gmMessageId!);
      expect(msg!.status).toBe("complete");
      const hasCompelResolution = (msg!.toolCalls ?? []).some(
        (tc: { toolName: string }) => tc.toolName === "compel_resolution"
      );
      expect(hasCompelResolution).toBe(true);
    });
  });

  it("compel refused — mesmo fluxo, fatePointDelta -1 no toolResult", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, sceneId, characterId, aspectId, playerMessageId } = await setupBase(t);

    let gmMessageId: Id<"messages">;
    let compelId: Id<"compels">;
    await t.run(async (ctx) => {
      gmMessageId = await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "gm",
        content: "",
        clientMessageId: "gm-cac003",
        status: "pending",
        createdAt: Date.now(),
        causedByMessageId: playerMessageId,
      });
      compelId = await ctx.db.insert("compels", {
        campaignId,
        aspectId,
        characterId,
        complication: "Você deve parar",
        status: "refused",
        createdAt: Date.now(),
        resolvedAt: Date.now(),
        triggeringMessageId: playerMessageId,
        pausedGmMessageId: gmMessageId,
      });
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: textStream("Narrativa com recusa"),
    });

    const result = await t.action(internal.processTurn.continueAfterCompel, {
      playerMessageId,
      gmMessageId: gmMessageId!,
      compelId: compelId!,
    });

    expect(result).toMatchObject({ success: true });

    await t.run(async (ctx) => {
      const msg = await ctx.db.get(gmMessageId!);
      const resolutionCall = (msg!.toolCalls ?? []).find(
        (tc: { toolName: string }) => tc.toolName === "compel_resolution"
      );
      expect(resolutionCall).toBeDefined();
      expect((resolutionCall!.toolResult as { fatePointDelta: number }).fatePointDelta).toBe(-1);
    });
  });

  it("compel não encontrado — retorna success false com reason compel_not_found", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, sceneId, playerMessageId } = await setupBase(t);

    let gmMessageId: Id<"messages">;
    await t.run(async (ctx) => {
      gmMessageId = await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "gm",
        content: "",
        clientMessageId: "gm-cac004",
        status: "pending",
        createdAt: Date.now(),
      });
    });

    // Criar um compel e deletar para simular ID inexistente
    let fakeCompelId: Id<"compels">;
    await t.run(async (ctx) => {
      const aspectId = await ctx.db
        .query("sceneAspects")
        .withIndex("by_scene", (q) => q.eq("sceneId", sceneId as Id<"scenes">))
        .first();
      const characterId = await ctx.db
        .query("characters")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .first();
      fakeCompelId = await ctx.db.insert("compels", {
        campaignId,
        aspectId: aspectId!._id,
        characterId: characterId!._id,
        complication: "temp",
        status: "pending",
        createdAt: Date.now(),
      });
      await ctx.db.delete(fakeCompelId);
    });

    const result = await t.action(internal.processTurn.continueAfterCompel, {
      playerMessageId,
      gmMessageId: gmMessageId!,
      compelId: fakeCompelId!,
    });

    expect(result).toMatchObject({ success: false, reason: "compel_not_found" });
  });
});

// --- Ciclo 5: resolveCompel agenda continueAfterCompel ---

describe("resolveCompel — agenda continueAfterCompel quando IDs presentes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("compel com triggeringMessageId + pausedGmMessageId após accept — agenda continueAfterCompel e GM fica complete", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId, sceneId, characterId, aspectId, playerMessageId } = await setupBase(t);

    let gmMessageId: Id<"messages">;
    let compelId: Id<"compels">;
    await t.run(async (ctx) => {
      gmMessageId = await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "gm",
        content: "Texto parcial",
        clientMessageId: "gm-rc001",
        status: "pending",
        createdAt: Date.now(),
        causedByMessageId: playerMessageId,
      });
      compelId = await ctx.db.insert("compels", {
        campaignId,
        aspectId,
        characterId,
        complication: "O fogo bloqueia",
        status: "pending",
        createdAt: Date.now(),
        triggeringMessageId: playerMessageId,
        pausedGmMessageId: gmMessageId,
      });
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: textStream("Narrativa continuada"),
    });

    await identity.mutation(api.compels.resolveCompel, {
      compelId: compelId!,
      decision: "accept",
    });

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await t.run(async (ctx) => {
      const msg = await ctx.db.get(gmMessageId!);
      expect(msg!.status).toBe("complete");
    });
  });

  it("compel SEM triggeringMessageId — resolve normalmente sem agendar", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId, sceneId, characterId, aspectId } = await setupBase(t);

    let compelId: Id<"compels">;
    await t.run(async (ctx) => {
      compelId = await ctx.db.insert("compels", {
        campaignId,
        aspectId,
        characterId,
        complication: "Sem contexto de turno",
        status: "pending",
        createdAt: Date.now(),
      });
    });

    await identity.mutation(api.compels.resolveCompel, {
      compelId: compelId!,
      decision: "accept",
    });

    await t.run(async (ctx) => {
      const compel = await ctx.db.get(compelId!);
      expect(compel!.status).toBe("accepted");
    });
  });
});
