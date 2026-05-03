/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Helper para criar entidades base
async function setupBase(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "executor@test.com",
      displayName: "Executor Test",
      tokenIdentifier: "token|executor-" + Math.random(),
    });
    const campaignId = await ctx.db.insert("campaigns", {
      userId,
      name: "Executor Campaign",
      premise: "Test",
      tone: "dark",
      expectedDuration: "one-shot",
      status: "active",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    });
    const characterId = await ctx.db.insert("characters", {
      campaignId,
      name: "Hero",
      aspects: ["Guerreiro Destemido"],
      skills: { Combate: 3, Atletismo: 2 },
      stunts: [],
      fatePoints: 3,
      stress: {
        physical: [false, false, false],
        mental: [false, false],
      },
      consequences: [],
    });
    const sceneId = await ctx.db.insert("scenes", {
      campaignId,
      title: "Primeira Cena",
      status: "active",
      createdAt: Date.now(),
    });
    const messageId = await ctx.db.insert("messages", {
      campaignId,
      role: "gm",
      content: "",
      clientMessageId: "gm-executor-test",
      status: "pending",
      createdAt: Date.now(),
    });
    const factId = await ctx.db.insert("facts", {
      campaignId,
      content: "O rei está morto.",
      visibility: "hidden",
    });
    const entityId = await ctx.db.insert("entities", {
      campaignId,
      type: "npc",
      name: "Lord Misterioso",
      description: "Um nobre enigmático.",
      visibility: "hidden",
    });
    return { userId, campaignId, characterId, sceneId, messageId, factId, entityId };
  });
}

describe("executeFateTool", () => {
  it("award_fate_point: incrementa fatePoints do personagem", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, characterId, messageId, sceneId } = await setupBase(t);

    await t.mutation(internal.tools.executor.executeFateTool, {
      toolName: "award_fate_point",
      toolParams: { characterId, reason: "Ato heróico" },
      context: { campaignId, messageId, sceneId },
    });

    const char = await t.run(async (ctx) => ctx.db.get(characterId));
    expect(char!.fatePoints).toBe(4); // era 3, ganhou 1
  });

  it("spend_fate_point: decrementa fatePoints do personagem", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, characterId, messageId, sceneId } = await setupBase(t);

    await t.mutation(internal.tools.executor.executeFateTool, {
      toolName: "spend_fate_point",
      toolParams: { characterId, reason: "Invocação de aspecto" },
      context: { campaignId, messageId, sceneId },
    });

    const char = await t.run(async (ctx) => ctx.db.get(characterId));
    expect(char!.fatePoints).toBe(2); // era 3, gastou 1
  });

  it("spend_fate_point: lança erro quando personagem não tem PD suficiente", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, characterId, messageId, sceneId } = await setupBase(t);

    // Zerar os PDs primeiro
    await t.run(async (ctx) => ctx.db.patch(characterId, { fatePoints: 0 }));

    await expect(
      t.mutation(internal.tools.executor.executeFateTool, {
        toolName: "spend_fate_point",
        toolParams: { characterId, reason: "Sem PD" },
        context: { campaignId, messageId, sceneId },
      })
    ).rejects.toThrow();
  });

  it("apply_stress: marca caixa de stress no personagem", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, characterId, messageId, sceneId } = await setupBase(t);

    const result = await t.mutation(internal.tools.executor.executeFateTool, {
      toolName: "apply_stress",
      toolParams: { characterId, amount: 1, track: "physical" },
      context: { campaignId, messageId, sceneId },
    });

    expect(result).toMatchObject({ absorbed: true });
  });

  it("apply_consequence: adiciona consequência ao personagem", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, characterId, messageId, sceneId } = await setupBase(t);

    await t.mutation(internal.tools.executor.executeFateTool, {
      toolName: "apply_consequence",
      toolParams: { characterId, severity: "mild", description: "Tornozelo torcido" },
      context: { campaignId, messageId, sceneId },
    });

    const char = await t.run(async (ctx) => ctx.db.get(characterId));
    expect(char!.consequences).toContainEqual({
      severity: "mild",
      description: "Tornozelo torcido",
    });
  });

  it("add_scene_aspect: cria aspecto na cena", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, sceneId, messageId } = await setupBase(t);

    const result = await t.mutation(internal.tools.executor.executeFateTool, {
      toolName: "add_scene_aspect",
      toolParams: { sceneId, text: "Chão Escorregadio", freeInvokes: 1 },
      context: { campaignId, messageId, sceneId },
    });

    expect(result).toHaveProperty("aspectId");

    const aspects = await t.run(async (ctx) =>
      ctx.db.query("sceneAspects").withIndex("by_scene", (q) => q.eq("sceneId", sceneId)).collect()
    );
    expect(aspects).toHaveLength(1);
    expect(aspects[0].text).toBe("Chão Escorregadio");
    expect(aspects[0].freeInvokes).toBe(1);
  });

  it("reveal_fact: muda visibility do fato para known", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, factId, messageId, sceneId } = await setupBase(t);

    await t.mutation(internal.tools.executor.executeFateTool, {
      toolName: "reveal_fact",
      toolParams: { factId },
      context: { campaignId, messageId, sceneId },
    });

    const fact = await t.run(async (ctx) => ctx.db.get(factId));
    expect(fact!.visibility).toBe("known");
    expect(fact!.revealedBy).toMatchObject({ messageId });
  });

  it("reveal_entity: muda visibility da entidade para known", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, entityId, messageId, sceneId } = await setupBase(t);

    await t.mutation(internal.tools.executor.executeFateTool, {
      toolName: "reveal_entity",
      toolParams: { entityId },
      context: { campaignId, messageId, sceneId },
    });

    const entity = await t.run(async (ctx) => ctx.db.get(entityId));
    expect(entity!.visibility).toBe("known");
  });

  it("change_scene: encerra cena atual e cria nova cena", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, sceneId, messageId } = await setupBase(t);

    const result = await t.mutation(internal.tools.executor.executeFateTool, {
      toolName: "change_scene",
      toolParams: { campaignId, title: "A Taverna", description: "Um lugar sombrio" },
      context: { campaignId, messageId, sceneId },
    });

    expect(result).toHaveProperty("newSceneId");

    // Cena antiga deve estar completed
    const oldScene = await t.run(async (ctx) => ctx.db.get(sceneId));
    expect(oldScene!.status).toBe("completed");

    // Nova cena deve estar active
    const newScene = await t.run(async (ctx) => ctx.db.get(result.newSceneId));
    expect(newScene!.title).toBe("A Taverna");
    expect(newScene!.status).toBe("active");
  });

  it("nome de tool desconhecido deve lançar erro", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, messageId, sceneId } = await setupBase(t);

    await expect(
      t.mutation(internal.tools.executor.executeFateTool, {
        toolName: "unknown_tool",
        toolParams: {},
        context: { campaignId, messageId, sceneId },
      })
    ).rejects.toThrow(/unknown tool/i);
  });
});
