/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";
import { ConvexError } from "convex/values";

const modules = import.meta.glob("./**/*.ts");

async function setupUserAndCampaign(
  t: ReturnType<typeof convexTest>,
  tokenIdentifier: string,
  email: string,
) {
  const identity = t.withIdentity({ tokenIdentifier, email });
  await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });
  const campaignId = await identity.mutation(api.campaigns.createCampaign, {
    name: "Campanha G019",
    premise: "Uma aventura épica.",
    tone: "dark fantasy",
    expectedDuration: "medium",
  });
  return { identity, campaignId: campaignId as Id<"campaigns"> };
}

// -----------------------------------------------------------------------
// G-019: triggers.scope agora é union: "global" | "scene" | "location"
// e oneShot: v.boolean() é obrigatório
// -----------------------------------------------------------------------
describe("G-019: triggers — scope como union e oneShot obrigatório", () => {
  it("cria trigger com scope global e oneShot false", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|g019_tr001", "g019_tr001@test.com");

    const triggerId = await identity.mutation(api.triggers.createTrigger, {
      campaignId,
      description: "Trigger global.",
      scope: "global",
      oneShot: false,
      effects: [],
    });

    await t.run(async (ctx) => {
      const trigger = await ctx.db.get(triggerId as Id<"triggers">);
      expect(trigger!.scope).toBe("global");
      expect(trigger!.oneShot).toBe(false);
    });
  });

  it("cria trigger com scope scene e oneShot true", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|g019_tr002", "g019_tr002@test.com");

    const triggerId = await identity.mutation(api.triggers.createTrigger, {
      campaignId,
      description: "Trigger de cena.",
      scope: "scene",
      oneShot: true,
      effects: [],
    });

    await t.run(async (ctx) => {
      const trigger = await ctx.db.get(triggerId as Id<"triggers">);
      expect(trigger!.scope).toBe("scene");
      expect(trigger!.oneShot).toBe(true);
    });
  });

  it("cria trigger com scope location", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|g019_tr003", "g019_tr003@test.com");

    const triggerId = await identity.mutation(api.triggers.createTrigger, {
      campaignId,
      description: "Trigger de localização.",
      scope: "location",
      oneShot: false,
      effects: [],
    });

    await t.run(async (ctx) => {
      const trigger = await ctx.db.get(triggerId as Id<"triggers">);
      expect(trigger!.scope).toBe("location");
    });
  });
});

// -----------------------------------------------------------------------
// G-019: entities.visibility agora inclui "rumored"
// -----------------------------------------------------------------------
describe("G-019: entities — visibility inclui rumored", () => {
  it("cria entity com visibility rumored", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|g019_ent001", "g019_ent001@test.com");

    const entityId = await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "npc",
      name: "NPC Misterioso",
      visibility: "rumored",
      description: "Apenas rumores sobre sua existência.",
    });

    await t.run(async (ctx) => {
      const entity = await ctx.db.get(entityId as Id<"entities">);
      expect(entity!.visibility).toBe("rumored");
    });
  });

  it("changeEntityVisibility aceita rumored", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|g019_ent002", "g019_ent002@test.com");

    const entityId = await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "location",
      name: "Ruínas Antigas",
      visibility: "hidden",
      description: "Local secreto.",
    });

    await identity.mutation(api.entities.changeEntityVisibility, {
      entityId: entityId as Id<"entities">,
      visibility: "rumored",
    });

    await t.run(async (ctx) => {
      const entity = await ctx.db.get(entityId as Id<"entities">);
      expect(entity!.visibility).toBe("rumored");
    });
  });
});

// -----------------------------------------------------------------------
// G-019: campaigns — novos campos opcionais llmConfig e currentSceneId
// -----------------------------------------------------------------------
describe("G-019: campaigns — llmConfig e currentSceneId opcionais", () => {
  it("llmConfig pode ser armazenado e recuperado", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|g019_camp001", "g019_camp001@test.com");

    await t.run(async (ctx) => {
      await ctx.db.patch(campaignId, {
        llmConfig: {
          narrativeModel: "gpt-4",
          utilityModel: "gpt-3.5-turbo",
          extractionModel: "gpt-3.5-turbo",
          embeddingModel: "text-embedding-3-small",
        },
      });
      const campaign = await ctx.db.get(campaignId);
      expect(campaign!.llmConfig).toBeDefined();
      expect(campaign!.llmConfig!.narrativeModel).toBe("gpt-4");
    });
  });

  it("currentSceneId pode ser armazenado e recuperado", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|g019_camp002", "g019_camp002@test.com");

    const sceneId = await identity.mutation(api.scenes.createScene, {
      campaignId,
      title: "Cena Inicial",
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(campaignId, { currentSceneId: sceneId as Id<"scenes"> });
      const campaign = await ctx.db.get(campaignId);
      expect(campaign!.currentSceneId).toBe(sceneId);
    });
  });
});

// -----------------------------------------------------------------------
// G-019: messages — novos campos opcionais
// -----------------------------------------------------------------------
describe("G-019: messages — novos campos opcionais", () => {
  it("campos de rastreamento podem ser armazenados", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|g019_msg001", "g019_msg001@test.com");

    await t.run(async (ctx) => {
      const msgId = await ctx.db.insert("messages", {
        campaignId,
        role: "gm",
        content: "Mensagem de teste.",
        clientMessageId: "client-001",
        status: "complete",
        tokensUsed: { input: 100, output: 200 },
        promptVersion: "v1.0",
      });
      const msg = await ctx.db.get(msgId);
      expect(msg!.tokensUsed).toEqual({ input: 100, output: 200 });
      expect(msg!.promptVersion).toBe("v1.0");
    });
  });

  it("causedByMessageId pode ser armazenado", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|g019_msg002", "g019_msg002@test.com");

    await t.run(async (ctx) => {
      const parentId = await ctx.db.insert("messages", {
        campaignId,
        role: "player",
        content: "Mensagem pai.",
        clientMessageId: "client-parent",
        status: "complete",
      });
      const childId = await ctx.db.insert("messages", {
        campaignId,
        role: "gm",
        content: "Resposta.",
        clientMessageId: "client-child",
        status: "complete",
        causedByMessageId: parentId,
      });
      const child = await ctx.db.get(childId);
      expect(child!.causedByMessageId).toBe(parentId);
    });
  });
});

// -----------------------------------------------------------------------
// G-019: facts — novos campos opcionais
// -----------------------------------------------------------------------
describe("G-019: facts — novos campos opcionais", () => {
  it("category e createdAt podem ser armazenados", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|g019_fact001", "g019_fact001@test.com");

    const factId = await identity.mutation(api.facts.createFact, {
      campaignId,
      content: "Fato com categoria.",
      visibility: "known",
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(factId as Id<"facts">, {
        category: "lore",
        createdAt: Date.now(),
      });
      const fact = await ctx.db.get(factId as Id<"facts">);
      expect(fact!.category).toBe("lore");
      expect(fact!.createdAt).toBeDefined();
    });
  });

  it("revealedBy pode ser armazenado", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|g019_fact002", "g019_fact002@test.com");

    await t.run(async (ctx) => {
      const msgId = await ctx.db.insert("messages", {
        campaignId,
        role: "gm",
        content: "Revelação.",
        clientMessageId: "client-reveal",
        status: "complete",
      });
      const factId = await ctx.db.insert("facts", {
        campaignId,
        content: "Fato revelado.",
        visibility: "known",
        revealedBy: {
          messageId: msgId,
          revealedAt: Date.now(),
        },
      });
      const fact = await ctx.db.get(factId);
      expect(fact!.revealedBy).toBeDefined();
      expect(fact!.revealedBy!.messageId).toBe(msgId);
    });
  });
});

// -----------------------------------------------------------------------
// G-019: summaries — tabela totalmente reescrita
// -----------------------------------------------------------------------
describe("G-019: summaries — tabela com campos completos", () => {
  it("insere um summary de cena com todos os campos obrigatórios", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|g019_sum001", "g019_sum001@test.com");

    await t.run(async (ctx) => {
      const summaryId = await ctx.db.insert("summaries", {
        campaignId,
        level: "scene",
        content: "A cena inicial foi intensa.",
        coversFrom: 1000,
        coversTo: 2000,
        createdAt: Date.now(),
      });
      const summary = await ctx.db.get(summaryId);
      expect(summary!.level).toBe("scene");
      expect(summary!.content).toBe("A cena inicial foi intensa.");
      expect(summary!.coversFrom).toBe(1000);
      expect(summary!.coversTo).toBe(2000);
    });
  });

  it("insere um summary de arc com campos opcionais", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|g019_sum002", "g019_sum002@test.com");

    await t.run(async (ctx) => {
      const summaryId = await ctx.db.insert("summaries", {
        campaignId,
        level: "arc",
        content: "O primeiro arco terminou.",
        coversFrom: 0,
        coversTo: 5000,
        createdAt: Date.now(),
        sourceMessageIds: [],
        sourceSceneIds: [],
      });
      const summary = await ctx.db.get(summaryId);
      expect(summary!.level).toBe("arc");
      expect(summary!.sourceMessageIds).toEqual([]);
    });
  });

  it("insere summary de campaign", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|g019_sum003", "g019_sum003@test.com");

    await t.run(async (ctx) => {
      const summaryId = await ctx.db.insert("summaries", {
        campaignId,
        level: "campaign",
        content: "A campanha toda resumida.",
        coversFrom: 0,
        coversTo: 99999,
        createdAt: Date.now(),
      });
      const summary = await ctx.db.get(summaryId);
      expect(summary!.level).toBe("campaign");
    });
  });
});

// -----------------------------------------------------------------------
// G-019: diceRolls — tabela totalmente reescrita
// -----------------------------------------------------------------------
describe("G-019: diceRolls — tabela com campos completos", () => {
  it("insere um diceRoll com todos os campos obrigatórios", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|g019_dice001", "g019_dice001@test.com");

    await t.run(async (ctx) => {
      const msgId = await ctx.db.insert("messages", {
        campaignId,
        role: "player",
        content: "Ação do jogador.",
        clientMessageId: "client-dice-001",
        status: "complete",
      });

      const diceId = await ctx.db.insert("diceRolls", {
        campaignId,
        messageId: msgId,
        type: "overcome",
        skillName: "Athletics",
        skillLevel: 3,
        invokedAspectIds: [],
        bonus: 0,
        diceResults: [1, 0, -1, 1],
        diceTotal: 1,
        finalResult: 4,
        description: "Tentativa de superar obstáculo.",
        seed: "abc123",
        rolledAt: Date.now(),
      });

      const roll = await ctx.db.get(diceId);
      expect(roll!.type).toBe("overcome");
      expect(roll!.skillName).toBe("Athletics");
      expect(roll!.finalResult).toBe(4);
    });
  });

  it("insere diceRoll com outcome e opposition opcionais", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|g019_dice002", "g019_dice002@test.com");

    await t.run(async (ctx) => {
      const msgId = await ctx.db.insert("messages", {
        campaignId,
        role: "player",
        content: "Ataque.",
        clientMessageId: "client-dice-002",
        status: "complete",
      });

      const diceId = await ctx.db.insert("diceRolls", {
        campaignId,
        messageId: msgId,
        type: "attack",
        skillName: "Fight",
        skillLevel: 2,
        invokedAspectIds: [],
        bonus: 0,
        diceResults: [1, 1, 0, -1],
        diceTotal: 1,
        finalResult: 3,
        description: "Ataque contra o inimigo.",
        opposition: 2,
        outcome: "success",
        seed: "xyz789",
        rolledAt: Date.now(),
      });

      const roll = await ctx.db.get(diceId);
      expect(roll!.outcome).toBe("success");
      expect(roll!.opposition).toBe(2);
    });
  });
});

// -----------------------------------------------------------------------
// G-019: compels — novos campos opcionais
// -----------------------------------------------------------------------
describe("G-019: compels — novos campos triggeringMessageId e pausedGmMessageId", () => {
  it("compel pode ser criado com triggeringMessageId e pausedGmMessageId", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|g019_comp001", "g019_comp001@test.com");

    const sceneId = await identity.mutation(api.scenes.createScene, {
      campaignId,
      title: "Cena do compel",
    });

    const characterId = await identity.mutation(api.characters.createCharacter, {
      campaignId,
      name: "Herói",
      aspects: ["Corajoso mas impulsivo"],
      skills: { Fight: 3 },
      stunts: [],
      fatePoints: 3,
      stress: { physical: [false, false], mental: [false, false] },
    });

    await t.run(async (ctx) => {
      const aspectId = await ctx.db.insert("sceneAspects", {
        sceneId: sceneId as Id<"scenes">,
        text: "Corajoso mas impulsivo",
        freeInvokes: 0,
      });

      const msgId = await ctx.db.insert("messages", {
        campaignId,
        role: "gm",
        content: "Compel iniciado.",
        clientMessageId: "client-compel-trigger",
        status: "complete",
      });

      const compelId = await ctx.db.insert("compels", {
        campaignId,
        aspectId,
        characterId: characterId as Id<"characters">,
        complication: "Age impulsivamente.",
        status: "pending",
        createdAt: Date.now(),
        triggeringMessageId: msgId,
        pausedGmMessageId: msgId,
      });

      const compel = await ctx.db.get(compelId);
      expect(compel!.triggeringMessageId).toBe(msgId);
      expect(compel!.pausedGmMessageId).toBe(msgId);
    });
  });
});
