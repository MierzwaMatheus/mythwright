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

async function setupActiveScene(
  identity: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  campaignId: Id<"campaigns">,
  title: string,
) {
  const sceneId = await identity.mutation(api.scenes.createScene, {
    campaignId,
    title,
  });
  await identity.mutation(api.scenes.updateSceneStatus, {
    sceneId: sceneId as Id<"scenes">,
    status: "active",
  });
  return sceneId as Id<"scenes">;
}

describe("sceneAspects.addSceneAspect", () => {
  it("freeInvokes defaults to 1 when not provided", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|sa001", "sa001@test.com");
    const sceneId = await setupActiveScene(identity, campaignId, "Cena Ativa");

    const aspectId = await identity.mutation(api.sceneAspects.addSceneAspect, {
      sceneId,
      text: "Neblina Densa",
    });

    await t.run(async (ctx) => {
      const aspect = await ctx.db.get(aspectId as Id<"sceneAspects">);
      expect(aspect).not.toBeNull();
      expect(aspect!.freeInvokes).toBe(1);
      expect(aspect!.text).toBe("Neblina Densa");
      expect(aspect!.sceneId).toBe(sceneId);
    });
  });

  it("custom freeInvokes value is persisted correctly", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|sa002", "sa002@test.com");
    const sceneId = await setupActiveScene(identity, campaignId, "Cena Ativa");

    const aspectId = await identity.mutation(api.sceneAspects.addSceneAspect, {
      sceneId,
      text: "Terreno Difícil",
      freeInvokes: 3,
    });

    await t.run(async (ctx) => {
      const aspect = await ctx.db.get(aspectId as Id<"sceneAspects">);
      expect(aspect!.freeInvokes).toBe(3);
    });
  });

  it("aspects of different scenes don't mix", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|sa003", "sa003@test.com");
    const sceneId1 = await setupActiveScene(identity, campaignId, "Cena 1");
    const sceneId2 = await setupActiveScene(identity, campaignId, "Cena 2");

    await identity.mutation(api.sceneAspects.addSceneAspect, {
      sceneId: sceneId1,
      text: "Aspecto da Cena 1",
    });

    await identity.mutation(api.sceneAspects.addSceneAspect, {
      sceneId: sceneId2,
      text: "Aspecto da Cena 2",
    });

    await t.run(async (ctx) => {
      const aspectsOfScene1 = await ctx.db
        .query("sceneAspects")
        .withIndex("by_scene", (q) => q.eq("sceneId", sceneId1))
        .take(10);
      expect(aspectsOfScene1).toHaveLength(1);
      expect(aspectsOfScene1[0].text).toBe("Aspecto da Cena 1");
    });
  });

  it("scene not found → ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|sa004", "sa004@test.com");
    // create a valid scene just to get a valid-looking but non-existent id structure
    const sceneId = await setupActiveScene(identity, campaignId, "Cena Temporária");

    // Delete the scene directly so the id is invalid
    await t.run(async (ctx) => {
      await ctx.db.delete(sceneId);
    });

    await expect(
      identity.mutation(api.sceneAspects.addSceneAspect, {
        sceneId,
        text: "Aspecto Órfão",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("scene not active (status inactive) → ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|sa005", "sa005@test.com");

    const sceneId = await identity.mutation(api.scenes.createScene, {
      campaignId,
      title: "Cena Inativa",
    });

    await expect(
      identity.mutation(api.sceneAspects.addSceneAspect, {
        sceneId: sceneId as Id<"scenes">,
        text: "Aspecto em Cena Inativa",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("no auth → ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|sa006", "sa006@test.com");
    const sceneId = await setupActiveScene(identity, campaignId, "Cena Ativa");

    await expect(
      t.mutation(api.sceneAspects.addSceneAspect, {
        sceneId,
        text: "Aspecto Sem Auth",
      }),
    ).rejects.toThrow(ConvexError);
  });
});
