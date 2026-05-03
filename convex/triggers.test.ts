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
