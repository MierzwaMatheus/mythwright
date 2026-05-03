/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";
import { ConvexError } from "convex/values";

async function setupCompel(
  t: ReturnType<typeof convexTest>,
  tokenIdentifier: string,
  email: string,
  initialFatePoints = 3,
) {
  const identity = t.withIdentity({ tokenIdentifier, email });
  await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });
  const campaignId = await identity.mutation(api.campaigns.createCampaign, {
    name: "Test",
    premise: "Test",
    tone: "dark",
    expectedDuration: "medium",
  });
  const sceneId = await identity.mutation(api.scenes.createScene, { campaignId: campaignId as Id<"campaigns">, title: "Cena" });
  await identity.mutation(api.scenes.updateSceneStatus, { sceneId: sceneId as Id<"scenes">, status: "active" });
  const characterId = await identity.mutation(api.characters.createCharacter, {
    campaignId: campaignId as Id<"campaigns">,
    name: "Herói",
    aspects: ["Corajoso"],
    skills: {},
    stunts: [],
    fatePoints: initialFatePoints,
    stress: { physical: [false, false], mental: [false, false] },
  });
  const aspectId = await identity.mutation(api.sceneAspects.addSceneAspect, {
    sceneId: sceneId as Id<"scenes">,
    text: "Em chamas",
    freeInvokes: 1,
  });
  const compelId = await identity.mutation(api.compels.beginCompel, {
    campaignId: campaignId as Id<"campaigns">,
    aspectId: aspectId as Id<"sceneAspects">,
    characterId: characterId as Id<"characters">,
    complication: "O fogo bloqueia a saída",
  });
  return {
    identity,
    campaignId: campaignId as Id<"campaigns">,
    sceneId: sceneId as Id<"scenes">,
    characterId: characterId as Id<"characters">,
    aspectId: aspectId as Id<"sceneAspects">,
    compelId: compelId as Id<"compels">,
  };
}

const modules = import.meta.glob("./**/*.ts");

async function setupUserCampaignAndScene(
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
  const sceneId = await identity.mutation(api.scenes.createScene, {
    campaignId: campaignId as Id<"campaigns">,
    title: "Cena",
  });
  await identity.mutation(api.scenes.updateSceneStatus, {
    sceneId: sceneId as Id<"scenes">,
    status: "active",
  });
  const characterId = await identity.mutation(api.characters.createCharacter, {
    campaignId: campaignId as Id<"campaigns">,
    name: "Herói",
    aspects: ["Corajoso"],
    skills: {},
    stunts: [],
    stress: { physical: [false, false], mental: [false, false] },
  });
  const aspectId = await identity.mutation(api.sceneAspects.addSceneAspect, {
    sceneId: sceneId as Id<"scenes">,
    text: "Em chamas",
    freeInvokes: 1,
  });
  return {
    identity,
    campaignId: campaignId as Id<"campaigns">,
    sceneId: sceneId as Id<"scenes">,
    characterId: characterId as Id<"characters">,
    aspectId: aspectId as Id<"sceneAspects">,
  };
}

describe("compels.getById", () => {
  it("retorna compel existente quando ID valido fornecido", async () => {
    const t = convexTest(schema, modules);
    const { compelId } = await setupCompel(t, "token|gb001", "gb001@test.com");

    const compel = await t.query(internal.compels.getById, { compelId });

    expect(compel).not.toBeNull();
    expect(compel!._id).toBe(compelId);
    expect(compel!.status).toBe("pending");
  });

  it("retorna null para ID inexistente", async () => {
    const t = convexTest(schema, modules);
    const { compelId } = await setupCompel(t, "token|gb002", "gb002@test.com");

    // Deletar o compel para tornar o ID inexistente
    await t.run(async (ctx) => { await ctx.db.delete(compelId); });

    const result = await t.query(internal.compels.getById, { compelId });

    expect(result).toBeNull();
  });
});

describe("compels.resolveCompel", () => {
  it("accept — fatePoints incrementa e compel fica accepted", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId, compelId } = await setupCompel(t, "token|rc001", "rc001@test.com", 3);

    await identity.mutation(api.compels.resolveCompel, {
      compelId,
      decision: "accept",
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.fatePoints).toBe(4);

      const compel = await ctx.db.get(compelId);
      expect(compel!.status).toBe("accepted");
      expect(typeof compel!.resolvedAt).toBe("number");
    });
  });

  it("refuse — fatePoints decrementa e compel fica refused", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId, compelId } = await setupCompel(t, "token|rc002", "rc002@test.com", 3);

    await identity.mutation(api.compels.resolveCompel, {
      compelId,
      decision: "refuse",
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.fatePoints).toBe(2);

      const compel = await ctx.db.get(compelId);
      expect(compel!.status).toBe("refused");
      expect(typeof compel!.resolvedAt).toBe("number");
    });
  });

  it("refuse sem fatePoints — lança ConvexError e compel permanece pending", async () => {
    const t = convexTest(schema, modules);
    const { identity, compelId } = await setupCompel(t, "token|rc003", "rc003@test.com", 0);

    await expect(
      identity.mutation(api.compels.resolveCompel, {
        compelId,
        decision: "refuse",
      }),
    ).rejects.toThrow(ConvexError);

    await t.run(async (ctx) => {
      const compel = await ctx.db.get(compelId);
      expect(compel!.status).toBe("pending");
    });
  });

  it("compel ja resolvido — lança ConvexError na segunda chamada", async () => {
    const t = convexTest(schema, modules);
    const { identity, compelId } = await setupCompel(t, "token|rc004", "rc004@test.com", 3);

    await identity.mutation(api.compels.resolveCompel, {
      compelId,
      decision: "accept",
    });

    await expect(
      identity.mutation(api.compels.resolveCompel, {
        compelId,
        decision: "accept",
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("compels.beginCompelInternal campos opcionais", () => {
  it("cria compel com triggeringMessageId e pausedGmMessageId quando ambos fornecidos", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, sceneId, aspectId, characterId } = await setupCompel(t, "token|bi001", "bi001@test.com");

    // Criar duas mensagens para usar como IDs
    let triggeringId: Id<"messages">;
    let pausedId: Id<"messages">;
    await t.run(async (ctx) => {
      triggeringId = await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "player",
        content: "Mensagem do jogador",
        clientMessageId: "client-bi001-a",
        status: "complete",
      });
      pausedId = await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "gm",
        content: "Mensagem do gm pausada",
        clientMessageId: "client-bi001-b",
        status: "pending",
      });
    });

    const compelId = await t.mutation(internal.compels.beginCompelInternal, {
      campaignId,
      aspectId,
      characterId,
      complication: "Complicação com IDs",
      triggeringMessageId: triggeringId!,
      pausedGmMessageId: pausedId!,
    });

    await t.run(async (ctx) => {
      const compel = await ctx.db.get(compelId as Id<"compels">);
      expect(compel!.triggeringMessageId).toBe(triggeringId!);
      expect(compel!.pausedGmMessageId).toBe(pausedId!);
    });
  });

  it("cria compel sem campos opcionais — comportamento existente nao quebra", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, aspectId, characterId } = await setupCompel(t, "token|bi002", "bi002@test.com");

    const compelId = await t.mutation(internal.compels.beginCompelInternal, {
      campaignId,
      aspectId,
      characterId,
      complication: "Complicacao sem IDs",
    });

    await t.run(async (ctx) => {
      const compel = await ctx.db.get(compelId as Id<"compels">);
      expect(compel).not.toBeNull();
      expect(compel!.triggeringMessageId).toBeUndefined();
      expect(compel!.pausedGmMessageId).toBeUndefined();
    });
  });
});

describe("compels.beginCompel", () => {
  it("cria compel pendente e retorna compelId", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId, aspectId, characterId } =
      await setupUserCampaignAndScene(t, "token|cp001", "cp001@test.com");

    const compelId = await identity.mutation(api.compels.beginCompel, {
      campaignId,
      aspectId,
      characterId,
      complication: "Você deve parar de lutar e fugir",
    });

    expect(typeof compelId).toBe("string");
    expect(compelId.length).toBeGreaterThan(0);
  });

  it("documento persiste com todos os campos corretos", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId, aspectId, characterId } =
      await setupUserCampaignAndScene(t, "token|cp002", "cp002@test.com");

    const compelId = await identity.mutation(api.compels.beginCompel, {
      campaignId,
      aspectId,
      characterId,
      complication: "Uma armadilha se fecha ao seu redor",
    });

    await t.run(async (ctx) => {
      const compel = await ctx.db.get(compelId as Id<"compels">);
      expect(compel).not.toBeNull();
      expect(compel!.campaignId).toBe(campaignId);
      expect(compel!.aspectId).toBe(aspectId);
      expect(compel!.characterId).toBe(characterId);
      expect(compel!.complication).toBe("Uma armadilha se fecha ao seu redor");
      expect(compel!.status).toBe("pending");
      expect(typeof compel!.createdAt).toBe("number");
    });
  });

  it("sem autenticacao — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, aspectId, characterId } =
      await setupUserCampaignAndScene(t, "token|cp003", "cp003@test.com");

    await expect(
      t.mutation(api.compels.beginCompel, {
        campaignId,
        aspectId,
        characterId,
        complication: "Complicação não autenticada",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("campanha de outro usuario — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, aspectId, characterId } =
      await setupUserCampaignAndScene(t, "token|cp004", "cp004@test.com");

    const other = t.withIdentity({ tokenIdentifier: "token|cp004b", email: "cp004b@test.com" });
    await other.mutation(api.users.upsertFromAuth, { displayName: "Outro GM" });

    await expect(
      other.mutation(api.compels.beginCompel, {
        campaignId,
        aspectId,
        characterId,
        complication: "Complicação não autorizada",
      }),
    ).rejects.toThrow(ConvexError);
  });
});
