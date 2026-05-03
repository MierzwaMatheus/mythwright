/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupBase(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "dice@test.com",
      displayName: "Dice Test",
      tokenIdentifier: "token|dice-" + Math.random(),
    });
    const campaignId = await ctx.db.insert("campaigns", {
      userId,
      name: "Dice Campaign",
      premise: "Test",
      tone: "heroic",
      expectedDuration: "one-shot",
      status: "active",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    });
    const characterId = await ctx.db.insert("characters", {
      campaignId,
      name: "Dice Hero",
      aspects: ["Guerreiro"],
      skills: { Combate: 3 },
      stunts: [],
      fatePoints: 3,
      stress: { physical: [false, false, false], mental: [false, false] },
      consequences: [],
    });
    const sceneId = await ctx.db.insert("scenes", {
      campaignId,
      title: "Arena",
      status: "active",
      createdAt: Date.now(),
    });
    const messageId = await ctx.db.insert("messages", {
      campaignId,
      role: "gm",
      content: "",
      clientMessageId: "gm-dice-test",
      status: "pending",
      createdAt: Date.now(),
    });
    return { userId, campaignId, characterId, sceneId, messageId };
  });
}

describe("rollFateDiceInternal", () => {
  it("deve persistir a rolagem em diceRolls e retornar rollId", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, messageId } = await setupBase(t);

    const result = await t.mutation(internal.tools.rollFateDice.rollFateDiceInternal, {
      campaignId,
      messageId,
      skillName: "Combate",
      skillLevel: 3,
      type: "attack",
      description: "Ataca o inimigo",
      seed: "test-seed-001",
    });

    expect(result).toHaveProperty("rollId");
    expect(result).toHaveProperty("diceResults");
    expect(result.diceResults).toHaveLength(4);
    expect(result).toHaveProperty("diceTotal");
    expect(result).toHaveProperty("finalResult");

    // Verificar persistência no banco
    const roll = await t.run(async (ctx) => ctx.db.get(result.rollId));
    expect(roll).toBeDefined();
    expect(roll!.skillName).toBe("Combate");
    expect(roll!.skillLevel).toBe(3);
    expect(roll!.type).toBe("attack");
    expect(roll!.seed).toBe("test-seed-001");
    expect(roll!.messageId).toEqual(messageId);
    expect(roll!.campaignId).toEqual(campaignId);
  });

  it("deve retornar finalResult igual a soma dos dados + skillLevel", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, messageId } = await setupBase(t);

    const result = await t.mutation(internal.tools.rollFateDice.rollFateDiceInternal, {
      campaignId,
      messageId,
      skillName: "Atletismo",
      skillLevel: 2,
      type: "overcome",
      description: "Pula o abismo",
      seed: "deterministic-seed-xyz",
    });

    // diceTotal = soma dos 4 dados + skillLevel (já somado pelo fate-engine)
    const diceSum = result.diceResults.reduce((a: number, b: number) => a + b, 0);
    expect(result.finalResult).toBe(diceSum + 2);
  });

  it("deve ser determinístico — mesma seed produz mesmo resultado", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, messageId } = await setupBase(t);

    const seed = "fixed-seed-for-determinism";

    const r1 = await t.mutation(internal.tools.rollFateDice.rollFateDiceInternal, {
      campaignId,
      messageId,
      skillName: "Combate",
      skillLevel: 3,
      type: "attack",
      description: "Primeiro ataque",
      seed,
    });

    const r2 = await t.mutation(internal.tools.rollFateDice.rollFateDiceInternal, {
      campaignId,
      messageId,
      skillName: "Combate",
      skillLevel: 3,
      type: "attack",
      description: "Segundo ataque (mesma seed)",
      seed,
    });

    expect(r1.diceResults).toEqual(r2.diceResults);
    expect(r1.finalResult).toBe(r2.finalResult);
  });

  it("deve calcular outcome quando opposition é fornecida", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, messageId } = await setupBase(t);

    const result = await t.mutation(internal.tools.rollFateDice.rollFateDiceInternal, {
      campaignId,
      messageId,
      skillName: "Furtividade",
      skillLevel: 2,
      type: "overcome",
      description: "Tenta se esconder",
      seed: "outcome-test-seed",
      opposition: 3,
    });

    expect(result).toHaveProperty("outcome");
    expect(["failure", "tie", "success", "success_with_style"]).toContain(result.outcome);

    // Verificar que persiste outcome no banco
    const roll = await t.run(async (ctx) => ctx.db.get(result.rollId));
    expect(roll!.outcome).toBe(result.outcome);
    expect(roll!.opposition).toBe(3);
  });

  it("sem opposition — outcome não é calculado", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, messageId } = await setupBase(t);

    const result = await t.mutation(internal.tools.rollFateDice.rollFateDiceInternal, {
      campaignId,
      messageId,
      skillName: "Percepção",
      skillLevel: 1,
      type: "create_advantage",
      description: "Observa o ambiente",
      seed: "no-opposition-seed",
    });

    expect(result.outcome).toBeUndefined();

    const roll = await t.run(async (ctx) => ctx.db.get(result.rollId));
    expect(roll!.outcome).toBeUndefined();
    expect(roll!.opposition).toBeUndefined();
  });

  it("deve persistir invokedAspectIds como array vazio por padrão", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, messageId } = await setupBase(t);

    const result = await t.mutation(internal.tools.rollFateDice.rollFateDiceInternal, {
      campaignId,
      messageId,
      skillName: "Combate",
      skillLevel: 3,
      type: "attack",
      description: "Ataque básico",
      seed: "aspect-default-seed",
    });

    const roll = await t.run(async (ctx) => ctx.db.get(result.rollId));
    expect(roll!.invokedAspectIds).toEqual([]);
  });

  it("diceResults deve conter apenas valores -1, 0 ou 1", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, messageId } = await setupBase(t);

    const result = await t.mutation(internal.tools.rollFateDice.rollFateDiceInternal, {
      campaignId,
      messageId,
      skillName: "Combate",
      skillLevel: 0,
      type: "defend",
      description: "Defende",
      seed: "dice-range-seed",
    });

    for (const die of result.diceResults) {
      expect([-1, 0, 1]).toContain(die);
    }
  });
});
