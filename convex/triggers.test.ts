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
    name: "Campanha de Teste",
    premise: "Uma aventura épica.",
    tone: "dark fantasy",
    expectedDuration: "medium",
  });
  return { identity, campaignId: campaignId as Id<"campaigns"> };
}

describe("triggers.createTrigger", () => {
  it("persiste com status armed e retorna triggerId", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|tr001", "tr001@test.com");

    const triggerId = await identity.mutation(api.triggers.createTrigger, {
      campaignId,
      description: "Quando o jogador mencionar o rei, revelar o segredo.",
      scope: "global",
      effects: [{ type: "reveal_fact", payload: { factId: "abc123" } }],
    });

    expect(typeof triggerId).toBe("string");
    expect(triggerId.length).toBeGreaterThan(0);
  });

  it("documento persiste com status armed e todos os campos", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|tr002", "tr002@test.com");

    const triggerId = await identity.mutation(api.triggers.createTrigger, {
      campaignId,
      description: "Gatilho de cena específica.",
      scope: "scene_001",
      effects: [
        { type: "spawn_npc", payload: { name: "Assassino" } },
        { type: "play_music", payload: { track: "danger" } },
      ],
    });

    await t.run(async (ctx) => {
      const trigger = await ctx.db.get(triggerId as Id<"triggers">);
      expect(trigger).not.toBeNull();
      expect(trigger!.campaignId).toBe(campaignId);
      expect(trigger!.description).toBe("Gatilho de cena específica.");
      expect(trigger!.scope).toBe("scene_001");
      expect(trigger!.status).toBe("armed");
      expect(trigger!.effects).toHaveLength(2);
      expect(trigger!.effects[0].type).toBe("spawn_npc");
    });
  });

  it("sem autenticacao — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|tr003", "tr003@test.com");

    await expect(
      t.mutation(api.triggers.createTrigger, {
        campaignId,
        description: "Gatilho sem auth.",
        scope: "global",
        effects: [],
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("campanha de outro usuario — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|tr004", "tr004@test.com");

    const other = t.withIdentity({ tokenIdentifier: "token|tr004b", email: "tr004b@test.com" });
    await other.mutation(api.users.upsertFromAuth, { displayName: "Outro GM" });

    await expect(
      other.mutation(api.triggers.createTrigger, {
        campaignId,
        description: "Gatilho de outro usuário.",
        scope: "global",
        effects: [],
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("triggers.updateTriggerStatus", () => {
  async function createArmedTrigger(
    identity: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
    campaignId: Id<"campaigns">,
  ) {
    return identity.mutation(api.triggers.createTrigger, {
      campaignId,
      description: "Gatilho de teste.",
      scope: "global",
      effects: [],
    });
  }

  it("armed → disabled é válido", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|uts001", "uts001@test.com");
    const triggerId = await createArmedTrigger(identity, campaignId);

    await identity.mutation(api.triggers.updateTriggerStatus, {
      triggerId: triggerId as Id<"triggers">,
      status: "disabled",
    });

    await t.run(async (ctx) => {
      const trigger = await ctx.db.get(triggerId as Id<"triggers">);
      expect(trigger!.status).toBe("disabled");
    });
  });

  it("disabled → armed é válido", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|uts002", "uts002@test.com");
    const triggerId = await createArmedTrigger(identity, campaignId);
    await identity.mutation(api.triggers.updateTriggerStatus, {
      triggerId: triggerId as Id<"triggers">,
      status: "disabled",
    });

    await identity.mutation(api.triggers.updateTriggerStatus, {
      triggerId: triggerId as Id<"triggers">,
      status: "armed",
    });

    await t.run(async (ctx) => {
      const trigger = await ctx.db.get(triggerId as Id<"triggers">);
      expect(trigger!.status).toBe("armed");
    });
  });

  it("trigger disabled não aparece em getArmedTriggersByScope", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|uts003", "uts003@test.com");
    const triggerId = await createArmedTrigger(identity, campaignId);

    await identity.mutation(api.triggers.updateTriggerStatus, {
      triggerId: triggerId as Id<"triggers">,
      status: "disabled",
    });

    const results = await identity.query(api.triggers.getArmedTriggersByScope, {
      campaignId,
    });

    expect(results).toHaveLength(0);
  });

  it("sem autenticacao — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|uts004", "uts004@test.com");
    const triggerId = await createArmedTrigger(identity, campaignId);

    await expect(
      t.mutation(api.triggers.updateTriggerStatus, {
        triggerId: triggerId as Id<"triggers">,
        status: "disabled",
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("triggers.resolveTriggerEffects", () => {
  it("executa change_entity_visibility e marca trigger como fired", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|rte002", "rte002@test.com");

    const entityId = await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "npc",
      name: "Guarda Real",
      visibility: "hidden",
      description: "Um guarda secreto do rei.",
    });

    const triggerId = await identity.mutation(api.triggers.createTrigger, {
      campaignId,
      description: "Revelar o guarda quando o rei for mencionado.",
      scope: "global",
      effects: [
        {
          type: "change_entity_visibility",
          payload: { entityId, visibility: "known" },
        },
      ],
    });

    await identity.action(api.triggers.resolveTriggerEffects, {
      triggeredIds: [triggerId as Id<"triggers">],
    });

    await t.run(async (ctx) => {
      const entity = await ctx.db.get(entityId as Id<"entities">);
      expect(entity!.visibility).toBe("known");

      const trigger = await ctx.db.get(triggerId as Id<"triggers">);
      expect(trigger!.status).toBe("fired");
      expect(trigger!.firedAt).toBeTypeOf("number");
    });
  });

  it("executa change_fact_visibility e marca trigger como fired", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|rte001", "rte001@test.com");

    const factId = await identity.mutation(api.facts.createFact, {
      campaignId,
      content: "O rei é um traidor.",
      visibility: "hidden",
    });

    const triggerId = await identity.mutation(api.triggers.createTrigger, {
      campaignId,
      description: "Revelar o fato quando o rei for mencionado.",
      scope: "global",
      effects: [
        {
          type: "change_fact_visibility",
          payload: { factId, visibility: "known" },
        },
      ],
    });

    await identity.action(api.triggers.resolveTriggerEffects, {
      triggeredIds: [triggerId as Id<"triggers">],
    });

    await t.run(async (ctx) => {
      const fact = await ctx.db.get(factId as Id<"facts">);
      expect(fact!.visibility).toBe("known");

      const trigger = await ctx.db.get(triggerId as Id<"triggers">);
      expect(trigger!.status).toBe("fired");
      expect(trigger!.firedAt).toBeTypeOf("number");
    });
  });
  it("ignora silenciosamente trigger com status fired (idempotencia)", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|rte004", "rte004@test.com");

    const factId = await identity.mutation(api.facts.createFact, {
      campaignId,
      content: "O rei é um traidor.",
      visibility: "hidden",
    });

    const triggerId = await identity.mutation(api.triggers.createTrigger, {
      campaignId,
      description: "Revelar o fato quando o rei for mencionado.",
      scope: "global",
      effects: [
        {
          type: "change_fact_visibility",
          payload: { factId, visibility: "known" },
        },
      ],
    });

    // Primeira chamada: executa o efeito e marca como fired
    await identity.action(api.triggers.resolveTriggerEffects, {
      triggeredIds: [triggerId as Id<"triggers">],
    });

    // Reverter manualmente a visibility para detectar se o efeito re-executar
    await t.run(async (ctx) => {
      await ctx.db.patch(factId as Id<"facts">, { visibility: "hidden" });
    });

    // Segunda chamada com o mesmo triggerId (já fired) — deve ser ignorada
    await identity.action(api.triggers.resolveTriggerEffects, {
      triggeredIds: [triggerId as Id<"triggers">],
    });

    await t.run(async (ctx) => {
      // Se o efeito foi re-executado, visibility voltaria a "known"
      // O comportamento correto é permanecer "hidden" (efeito ignorado)
      const fact = await ctx.db.get(factId as Id<"facts">);
      expect(fact!.visibility).toBe("hidden");

      // Trigger deve continuar fired, sem erro
      const trigger = await ctx.db.get(triggerId as Id<"triggers">);
      expect(trigger!.status).toBe("fired");
    });
  });

  it("executa multiplos efeitos em sequencia e marca trigger como fired", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|rte003", "rte003@test.com");

    const factId = await identity.mutation(api.facts.createFact, {
      campaignId,
      content: "Segredo da aliança.",
      visibility: "hidden",
    });

    const entityId = await identity.mutation(api.entities.createEntity, {
      campaignId,
      type: "faction",
      name: "Aliança Sombria",
      visibility: "hidden",
      description: "Uma facção secreta.",
    });

    const triggerId = await identity.mutation(api.triggers.createTrigger, {
      campaignId,
      description: "Revelar tudo sobre a aliança.",
      scope: "global",
      effects: [
        {
          type: "change_fact_visibility",
          payload: { factId, visibility: "known" },
        },
        {
          type: "change_entity_visibility",
          payload: { entityId, visibility: "known" },
        },
      ],
    });

    await identity.action(api.triggers.resolveTriggerEffects, {
      triggeredIds: [triggerId as Id<"triggers">],
    });

    await t.run(async (ctx) => {
      const fact = await ctx.db.get(factId as Id<"facts">);
      expect(fact!.visibility).toBe("known");

      const entity = await ctx.db.get(entityId as Id<"entities">);
      expect(entity!.visibility).toBe("known");

      const trigger = await ctx.db.get(triggerId as Id<"triggers">);
      expect(trigger!.status).toBe("fired");
      expect(trigger!.firedAt).toBeTypeOf("number");
    });
  });
});

describe("triggers.getArmedTriggersByScope", () => {
  async function createTrigger(
    identity: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
    campaignId: Id<"campaigns">,
    scope: string,
  ) {
    return identity.mutation(api.triggers.createTrigger, {
      campaignId,
      description: `Gatilho de ${scope}.`,
      scope,
      effects: [],
    });
  }

  it("retorna apenas gatilhos global quando sceneId não fornecido", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|gats001", "gats001@test.com");

    await createTrigger(identity, campaignId, "global");
    await createTrigger(identity, campaignId, "scene_001");

    const results = await identity.query(api.triggers.getArmedTriggersByScope, {
      campaignId,
    });

    expect(results).toHaveLength(1);
    expect(results[0].scope).toBe("global");
  });

  it("retorna global e da sceneId correta quando sceneId fornecida", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|gats002", "gats002@test.com");

    await createTrigger(identity, campaignId, "global");
    await createTrigger(identity, campaignId, "scene_001");
    await createTrigger(identity, campaignId, "scene_002");

    const results = await identity.query(api.triggers.getArmedTriggersByScope, {
      campaignId,
      sceneId: "scene_001",
    });

    expect(results).toHaveLength(2);
    const scopes = results.map((r) => r.scope);
    expect(scopes).toContain("global");
    expect(scopes).toContain("scene_001");
    expect(scopes).not.toContain("scene_002");
  });

  it("não retorna gatilhos disabled mesmo que scope bata", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|gats003", "gats003@test.com");

    const triggerId = await createTrigger(identity, campaignId, "global");
    await identity.mutation(api.triggers.updateTriggerStatus, {
      triggerId: triggerId as Id<"triggers">,
      status: "disabled",
    });

    const results = await identity.query(api.triggers.getArmedTriggersByScope, {
      campaignId,
    });

    expect(results).toHaveLength(0);
  });

  it("não retorna gatilhos de outra campanha", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|gats004", "gats004@test.com");
    const { campaignId: otherCampaignId } = await setupUserAndCampaign(t, "token|gats004b", "gats004b@test.com");

    await createTrigger(identity, campaignId, "global");

    const results = await identity.query(api.triggers.getArmedTriggersByScope, {
      campaignId: otherCampaignId,
    });

    expect(results).toHaveLength(0);
  });

  it("retorna lista vazia quando não há gatilhos armed", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|gats005", "gats005@test.com");

    const results = await identity.query(api.triggers.getArmedTriggersByScope, {
      campaignId,
    });

    expect(results).toHaveLength(0);
  });
});
