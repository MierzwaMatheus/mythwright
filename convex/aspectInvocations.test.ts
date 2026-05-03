/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";
import { ConvexError } from "convex/values";

const modules = import.meta.glob("./**/*.ts");

async function setupFullScene(t: ReturnType<typeof convexTest>) {
  const identity = t.withIdentity({
    tokenIdentifier: "token|aspect001",
    email: "aspect001@test.com",
  });

  await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });

  const campaignId = await identity.mutation(api.campaigns.createCampaign, {
    name: "Test Campaign",
    premise: "Test premise",
    tone: "dark",
    expectedDuration: "medium",
  }) as Id<"campaigns">;

  const characterId = await identity.mutation(api.characters.createCharacter, {
    campaignId,
    name: "Hero",
    aspects: [],
    skills: {},
    stunts: [],
    fatePoints: 3,
    stress: { physical: [false, false, false], mental: [false, false] },
  }) as Id<"characters">;

  const sceneId = await identity.mutation(api.scenes.createScene, {
    campaignId,
    title: "Test Scene",
  }) as Id<"scenes">;

  await identity.mutation(api.scenes.updateSceneStatus, {
    sceneId,
    status: "active",
  });

  const aspectId = await identity.mutation(api.sceneAspects.addSceneAspect, {
    sceneId,
    text: "On Fire",
    freeInvokes: 2,
  }) as Id<"sceneAspects">;

  const targetRollId = await t.run(async (ctx) => {
    return await ctx.db.insert("diceRolls", { campaignId });
  }) as Id<"diceRolls">;

  return { identity, campaignId, characterId, sceneId, aspectId, targetRollId };
}

describe("aspectInvocations.invokeAspect", () => {
  it("free invoke decrements freeInvokes on aspect from 2 to 1", async () => {
    const t = convexTest(schema, modules);
    const { identity, aspectId, targetRollId, characterId } = await setupFullScene(t);

    await identity.mutation(api.aspectInvocations.invokeAspect, {
      aspectId,
      targetRollId,
      effect: "bonus_2",
      payerId: characterId,
      usesFreeInvoke: true,
    });

    await t.run(async (ctx) => {
      const aspect = await ctx.db.get(aspectId);
      expect(aspect!.freeInvokes).toBe(1);
    });
  });

  it("free invoke with freeInvokes already 0 throws ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { identity, aspectId, targetRollId, characterId } = await setupFullScene(t);

    await t.run(async (ctx) => {
      await ctx.db.patch(aspectId, { freeInvokes: 0 });
    });

    await expect(
      identity.mutation(api.aspectInvocations.invokeAspect, {
        aspectId,
        targetRollId,
        effect: "bonus_2",
        payerId: characterId,
        usesFreeInvoke: true,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("paid invocation calls spendFatePoint — character fatePoints decremented and invocation recorded", async () => {
    const t = convexTest(schema, modules);
    const { identity, aspectId, targetRollId, characterId } = await setupFullScene(t);

    await identity.mutation(api.aspectInvocations.invokeAspect, {
      aspectId,
      targetRollId,
      effect: "reroll",
      payerId: characterId,
      usesFreeInvoke: false,
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.fatePoints).toBe(2);

      const invocations = await ctx.db
        .query("aspectInvocations")
        .withIndex("by_aspect", (q) => q.eq("aspectId", aspectId))
        .collect();
      expect(invocations).toHaveLength(1);
      expect(invocations[0].usesFreeInvoke).toBe(false);
    });
  });

  it("invocation is always recorded with correct fields", async () => {
    const t = convexTest(schema, modules);
    const { identity, aspectId, targetRollId, characterId } = await setupFullScene(t);

    const invocationId = await identity.mutation(api.aspectInvocations.invokeAspect, {
      aspectId,
      targetRollId,
      effect: "bonus_2",
      payerId: characterId,
      usesFreeInvoke: true,
    });

    await t.run(async (ctx) => {
      const invocation = await ctx.db.get(invocationId as Id<"aspectInvocations">);
      expect(invocation).not.toBeNull();
      expect(invocation!.aspectId).toBe(aspectId);
      expect(invocation!.targetRollId).toBe(targetRollId);
      expect(invocation!.effect).toBe("bonus_2");
      expect(invocation!.payerId).toBe(characterId);
      expect(invocation!.usesFreeInvoke).toBe(true);
      expect(typeof invocation!.invokedAt).toBe("number");
    });
  });

  it("no auth throws ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { aspectId, targetRollId, characterId } = await setupFullScene(t);

    await expect(
      t.mutation(api.aspectInvocations.invokeAspect, {
        aspectId,
        targetRollId,
        effect: "bonus_2",
        payerId: characterId,
        usesFreeInvoke: true,
      }),
    ).rejects.toThrow(ConvexError);
  });
});
