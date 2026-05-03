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
    description: "Descrição da cena inicial.",
  });
  await identity.mutation(api.scenes.updateSceneStatus, {
    sceneId: sceneId as Id<"scenes">,
    status: "active",
  });
  return sceneId as Id<"scenes">;
}

describe("scenes.changeScene", () => {
  it("cena anterior recebe endedAt e status completed", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|cs001", "cs001@test.com");
    const oldSceneId = await setupActiveScene(identity, campaignId, "Cena Inicial");

    await identity.mutation(api.scenes.changeScene, {
      campaignId,
      newSceneTitle: "Nova Cena",
      presentEntityIds: [],
    });

    await t.run(async (ctx) => {
      const oldScene = await ctx.db.get(oldSceneId);
      expect(oldScene).not.toBeNull();
      expect(oldScene!.status).toBe("completed");
      expect(typeof oldScene!.endedAt).toBe("number");
    });
  });

  it("nova cena e criada como ativa com os dados corretos", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|cs002", "cs002@test.com");
    await setupActiveScene(identity, campaignId, "Cena Inicial");

    const newSceneId = await identity.mutation(api.scenes.changeScene, {
      campaignId,
      newSceneTitle: "A Taverna Sombria",
      newSceneDescription: "Uma taverna cheia de segredos.",
      presentEntityIds: [],
    });

    expect(typeof newSceneId).toBe("string");
    expect(newSceneId.length).toBeGreaterThan(0);

    await t.run(async (ctx) => {
      const newScene = await ctx.db.get(newSceneId as Id<"scenes">);
      expect(newScene).not.toBeNull();
      expect(newScene!.status).toBe("active");
      expect(newScene!.title).toBe("A Taverna Sombria");
      expect(newScene!.description).toBe("Uma taverna cheia de segredos.");
      expect(newScene!.campaignId).toBe(campaignId);
      expect(typeof newScene!.createdAt).toBe("number");
    });
  });

  it("lanca ConvexError se nao ha cena ativa na campanha", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|cs003", "cs003@test.com");

    await expect(
      identity.mutation(api.scenes.changeScene, {
        campaignId,
        newSceneTitle: "Cena Sem Ativa Anterior",
        presentEntityIds: [],
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("lanca ConvexError sem autenticacao", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|cs004", "cs004@test.com");

    await expect(
      t.mutation(api.scenes.changeScene, {
        campaignId,
        newSceneTitle: "Cena Sem Auth",
        presentEntityIds: [],
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("lanca ConvexError se campanha pertence a outro usuario", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|cs005", "cs005@test.com");

    const other = t.withIdentity({ tokenIdentifier: "token|cs005b", email: "cs005b@test.com" });
    await other.mutation(api.users.upsertFromAuth, { displayName: "Outro GM" });

    await expect(
      other.mutation(api.scenes.changeScene, {
        campaignId,
        newSceneTitle: "Cena Nao Autorizada",
        presentEntityIds: [],
      }),
    ).rejects.toThrow(ConvexError);
  });
});
