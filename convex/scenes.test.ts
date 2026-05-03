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

describe("scenes.createScene", () => {
  it("persiste cena e retorna sceneId", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|sc001", "sc001@test.com");

    const sceneId = await identity.mutation(api.scenes.createScene, {
      campaignId,
      title: "A Taverna do Porto",
      description: "Uma taverna movimentada à beira do porto.",
    });

    expect(typeof sceneId).toBe("string");
    expect(sceneId.length).toBeGreaterThan(0);
  });

  it("documento persiste com todos os campos corretos", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|sc002", "sc002@test.com");

    const sceneId = await identity.mutation(api.scenes.createScene, {
      campaignId,
      title: "A Floresta Sombria",
      description: "Uma floresta densa e perigosa.",
    });

    await t.run(async (ctx) => {
      const scene = await ctx.db.get(sceneId as Id<"scenes">);
      expect(scene).not.toBeNull();
      expect(scene!.campaignId).toBe(campaignId);
      expect(scene!.title).toBe("A Floresta Sombria");
      expect(scene!.description).toBe("Uma floresta densa e perigosa.");
      expect(scene!.status).toBe("inactive");
      expect(typeof scene!.createdAt).toBe("number");
    });
  });

  it("description opcional — cria cena sem description", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|sc003", "sc003@test.com");

    const sceneId = await identity.mutation(api.scenes.createScene, {
      campaignId,
      title: "Cena Sem Descrição",
    });

    await t.run(async (ctx) => {
      const scene = await ctx.db.get(sceneId as Id<"scenes">);
      expect(scene).not.toBeNull();
      expect(scene!.description).toBeUndefined();
    });
  });

  it("sem autenticacao — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|sc004", "sc004@test.com");

    await expect(
      t.mutation(api.scenes.createScene, {
        campaignId,
        title: "Cena Sem Auth",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("campanha de outro usuario — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|sc005", "sc005@test.com");

    const other = t.withIdentity({ tokenIdentifier: "token|sc005b", email: "sc005b@test.com" });
    await other.mutation(api.users.upsertFromAuth, { displayName: "Outro GM" });

    await expect(
      other.mutation(api.scenes.createScene, {
        campaignId,
        title: "Cena Não Autorizada",
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("scenes.listScenes", () => {
  it("retorna lista de cenas da campanha ordenadas por createdAt desc", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ls001", "ls001@test.com");

    await identity.mutation(api.scenes.createScene, {
      campaignId,
      title: "Primeira Cena",
    });

    await identity.mutation(api.scenes.createScene, {
      campaignId,
      title: "Segunda Cena",
    });

    const scenes = await identity.query(api.scenes.listScenes, { campaignId });

    expect(scenes).toHaveLength(2);
    // Mais recente primeiro
    expect(scenes[0].title).toBe("Segunda Cena");
    expect(scenes[1].title).toBe("Primeira Cena");
  });

  it("retorna lista vazia quando nao ha cenas", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ls002", "ls002@test.com");

    const scenes = await identity.query(api.scenes.listScenes, { campaignId });
    expect(scenes).toEqual([]);
  });

  it("nao retorna cenas de outra campanha", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ls003", "ls003@test.com");
    const { campaignId: otherCampaignId } = await setupUserAndCampaign(t, "token|ls003b", "ls003b@test.com");

    await identity.mutation(api.scenes.createScene, {
      campaignId,
      title: "Cena da Campanha A",
    });

    const scenes = await identity.query(api.scenes.listScenes, { campaignId: otherCampaignId });
    expect(scenes).toHaveLength(0);
  });

  it("sem autenticacao — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|ls004", "ls004@test.com");

    await expect(
      t.query(api.scenes.listScenes, { campaignId }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("scenes.updateSceneStatus", () => {
  it("inactive → active é válido", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|uss001", "uss001@test.com");

    const sceneId = await identity.mutation(api.scenes.createScene, {
      campaignId,
      title: "Cena de Teste",
    });

    await identity.mutation(api.scenes.updateSceneStatus, {
      sceneId: sceneId as Id<"scenes">,
      status: "active",
    });

    await t.run(async (ctx) => {
      const scene = await ctx.db.get(sceneId as Id<"scenes">);
      expect(scene!.status).toBe("active");
    });
  });

  it("active → completed é válido", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|uss002", "uss002@test.com");

    const sceneId = await identity.mutation(api.scenes.createScene, {
      campaignId,
      title: "Cena de Teste",
    });

    await identity.mutation(api.scenes.updateSceneStatus, {
      sceneId: sceneId as Id<"scenes">,
      status: "active",
    });

    await identity.mutation(api.scenes.updateSceneStatus, {
      sceneId: sceneId as Id<"scenes">,
      status: "completed",
    });

    await t.run(async (ctx) => {
      const scene = await ctx.db.get(sceneId as Id<"scenes">);
      expect(scene!.status).toBe("completed");
    });
  });

  it("sem autenticacao — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|uss003", "uss003@test.com");

    const sceneId = await identity.mutation(api.scenes.createScene, {
      campaignId,
      title: "Cena de Teste",
    });

    await expect(
      t.mutation(api.scenes.updateSceneStatus, {
        sceneId: sceneId as Id<"scenes">,
        status: "active",
      }),
    ).rejects.toThrow(ConvexError);
  });
});
