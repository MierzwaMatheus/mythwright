/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";
import { ConvexError } from "convex/values";

const modules = import.meta.glob("./**/*.ts");

const defaultCharacterInput = {
  name: "Aric Stormhand",
  aspects: ["Mago errante", "Dívida com o passado"],
  skills: { Fight: 3, Lore: 4 },
  stunts: ["Arcane Armor"],
  stress: {
    physical: [false, false],
    mental: [false, false, false],
  },
};

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

describe("characters.createCharacter", () => {
  it("happy path — cria personagem com todos os campos e retorna _id", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ch001", "ch001@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
      fatePoints: 5,
    });

    expect(typeof characterId).toBe("string");
    expect(characterId.length).toBeGreaterThan(0);

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId as Id<"characters">);
      expect(character).not.toBeNull();
      expect(character!.name).toBe("Aric Stormhand");
      expect(character!.aspects).toEqual(["Mago errante", "Dívida com o passado"]);
      expect(character!.skills).toEqual({ Fight: 3, Lore: 4 });
      expect(character!.stunts).toEqual(["Arcane Armor"]);
      expect(character!.fatePoints).toBe(5);
      expect(character!.stress).toEqual({
        physical: [false, false],
        mental: [false, false, false],
      });
      expect(character!.campaignId).toBe(campaignId);
    });
  });

  it("fatePoints padrao — omitir resulta em 3", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ch002", "ch002@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId as Id<"characters">);
      expect(character!.fatePoints).toBe(3);
    });
  });

  it("consequences sempre comeca vazio", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ch003", "ch003@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId as Id<"characters">);
      expect(character!.consequences).toEqual([]);
    });
  });

  it("maximo 5 aspects — 6 aspects rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ch004", "ch004@test.com");

    await expect(
      identity.mutation(api.characters.createCharacter, {
        ...defaultCharacterInput,
        campaignId,
        aspects: ["A1", "A2", "A3", "A4", "A5", "A6"],
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("sem autenticacao — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|ch005", "ch005@test.com");

    await expect(
      t.mutation(api.characters.createCharacter, {
        ...defaultCharacterInput,
        campaignId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("campanha inexistente — rejeita com erro", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|ch006", email: "ch006@test.com" });
    await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });

    // Cria e deleta uma campanha para obter um ID válido porém inexistente
    const validButDeletedId = await identity.mutation(api.campaigns.createCampaign, {
      name: "Campanha deletada",
      premise: "Sera deletada.",
      tone: "dark",
      expectedDuration: "one-shot",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete(validButDeletedId as Id<"campaigns">);
    });

    await expect(
      identity.mutation(api.characters.createCharacter, {
        ...defaultCharacterInput,
        campaignId: validButDeletedId as Id<"campaigns">,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("campanha de outro usuario — rejeita com ConvexError Unauthorized", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|ch007", "ch007@test.com");

    const other = t.withIdentity({ tokenIdentifier: "token|ch007b", email: "ch007b@test.com" });
    await other.mutation(api.users.upsertFromAuth, { displayName: "Outro GM" });

    await expect(
      other.mutation(api.characters.createCharacter, {
        ...defaultCharacterInput,
        campaignId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("characters.updateCharacterField", () => {
  it("atualiza campo e registra log em characterEditLogs", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ucf001", "ucf001@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
      fatePoints: 3,
    });

    // Atualiza campo name
    await identity.mutation(api.characters.updateCharacterField, {
      characterId: characterId as Id<"characters">,
      field: "name",
      value: "Aric o Poderoso",
    });

    // Atualiza campo fatePoints
    await identity.mutation(api.characters.updateCharacterField, {
      characterId: characterId as Id<"characters">,
      field: "fatePoints",
      value: 5,
    });

    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query("characterEditLogs")
        .withIndex("by_character", (q) => q.eq("characterId", characterId as Id<"characters">))
        .collect();

      expect(logs).toHaveLength(2);

      const nameLog = logs.find((l) => l.field === "name");
      expect(nameLog).toBeDefined();
      expect(nameLog!.oldValue).toBe("Aric Stormhand");
      expect(nameLog!.newValue).toBe("Aric o Poderoso");

      const fateLog = logs.find((l) => l.field === "fatePoints");
      expect(fateLog).toBeDefined();
      expect(fateLog!.oldValue).toBe(3);
      expect(fateLog!.newValue).toBe(5);
    });
  });

  it("log registra oldValue e newValue corretos apos atualizar name", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ucf002", "ucf002@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      name: "Aragorn",
      campaignId,
    });

    await identity.mutation(api.characters.updateCharacterField, {
      characterId: characterId as Id<"characters">,
      field: "name",
      value: "Strider",
    });

    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query("characterEditLogs")
        .withIndex("by_character", (q) => q.eq("characterId", characterId as Id<"characters">))
        .collect();

      expect(logs).toHaveLength(1);
      expect(logs[0].oldValue).toBe("Aragorn");
      expect(logs[0].newValue).toBe("Strider");
    });
  });

  it("log registra field correto com o nome exato do campo passado", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ucf003", "ucf003@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
    });

    await identity.mutation(api.characters.updateCharacterField, {
      characterId: characterId as Id<"characters">,
      field: "name",
      value: "Novo Nome",
    });

    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query("characterEditLogs")
        .withIndex("by_character", (q) => q.eq("characterId", characterId as Id<"characters">))
        .collect();

      expect(logs).toHaveLength(1);
      expect(logs[0].field).toBe("name");
    });
  });

  it("log registra timestamp como numero maior que zero", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ucf004", "ucf004@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
    });

    await identity.mutation(api.characters.updateCharacterField, {
      characterId: characterId as Id<"characters">,
      field: "name",
      value: "Nome Atualizado",
    });

    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query("characterEditLogs")
        .withIndex("by_character", (q) => q.eq("characterId", characterId as Id<"characters">))
        .collect();

      expect(logs).toHaveLength(1);
      expect(typeof logs[0].timestamp).toBe("number");
      expect(logs[0].timestamp).toBeGreaterThan(0);
    });
  });

  it("log registra messageId quando fornecido", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ucf005", "ucf005@test.com");

    // Cria uma mensagem para obter um messageId valido
    let messageId: Id<"messages">;
    await t.run(async (ctx) => {
      messageId = await ctx.db.insert("messages", {
        campaignId,
      });
    });

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
    });

    await identity.mutation(api.characters.updateCharacterField, {
      characterId: characterId as Id<"characters">,
      field: "name",
      value: "Nome Com Mensagem",
      messageId: messageId!,
    });

    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query("characterEditLogs")
        .withIndex("by_character", (q) => q.eq("characterId", characterId as Id<"characters">))
        .collect();

      expect(logs).toHaveLength(1);
      expect(logs[0].messageId).toBe(messageId!);
    });
  });

  it("log sem messageId quando omitido", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|ucf006", "ucf006@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
    });

    await identity.mutation(api.characters.updateCharacterField, {
      characterId: characterId as Id<"characters">,
      field: "name",
      value: "Nome Sem Mensagem",
    });

    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query("characterEditLogs")
        .withIndex("by_character", (q) => q.eq("characterId", characterId as Id<"characters">))
        .collect();

      expect(logs).toHaveLength(1);
      expect(logs[0].messageId).toBeUndefined();
    });
  });
});

describe("characters.awardFatePoint", () => {
  it("happy path — incrementa fatePoints de 3 para 4", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|afp001", "afp001@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
      fatePoints: 3,
    });

    await identity.mutation(api.characters.awardFatePoint, {
      characterId: characterId as Id<"characters">,
      reason: "Roleplay excelente",
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId as Id<"characters">);
      expect(character!.fatePoints).toBe(4);
    });
  });

  it("registro no log — grava fatePoints com oldValue, newValue e reason corretos", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|afp002", "afp002@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
      fatePoints: 3,
    });

    await identity.mutation(api.characters.awardFatePoint, {
      characterId: characterId as Id<"characters">,
      reason: "Roleplay excelente",
    });

    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query("characterEditLogs")
        .withIndex("by_character", (q) => q.eq("characterId", characterId as Id<"characters">))
        .collect();

      expect(logs).toHaveLength(1);
      expect(logs[0].field).toBe("fatePoints");
      expect(logs[0].oldValue).toBe(3);
      expect(logs[0].newValue).toBe(4);
      expect(logs[0].reason).toBe("Roleplay excelente");
      expect(typeof logs[0].timestamp).toBe("number");
    });
  });

  it("sem autenticacao — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|afp003", "afp003@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
      fatePoints: 3,
    });

    await expect(
      t.mutation(api.characters.awardFatePoint, {
        characterId: characterId as Id<"characters">,
        reason: "Sem auth",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("personagem de outra campanha — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|afp004", "afp004@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
      fatePoints: 3,
    });

    const other = t.withIdentity({ tokenIdentifier: "token|afp004b", email: "afp004b@test.com" });
    await other.mutation(api.users.upsertFromAuth, { displayName: "Outro GM" });

    await expect(
      other.mutation(api.characters.awardFatePoint, {
        characterId: characterId as Id<"characters">,
        reason: "Tentativa não autorizada",
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("characters.spendFatePoint", () => {
  it("erro saldo zero — rejeita com ConvexError quando fatePoints é 0", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|sfp001", "sfp001@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
      fatePoints: 0,
    });

    await expect(
      identity.mutation(api.characters.spendFatePoint, {
        characterId: characterId as Id<"characters">,
        reason: "test",
      }),
    ).rejects.toThrow("Sem pontos de destino disponíveis");
  });

  it("happy path — decrementa fatePoints de 3 para 2", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|sfp002", "sfp002@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
      fatePoints: 3,
    });

    await identity.mutation(api.characters.spendFatePoint, {
      characterId: characterId as Id<"characters">,
      reason: "Invocação de aspecto",
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId as Id<"characters">);
      expect(character!.fatePoints).toBe(2);
    });
  });

  it("registro no log — grava entrada com campos corretos em characterEditLogs", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|sfp003", "sfp003@test.com");

    const characterId = await identity.mutation(api.characters.createCharacter, {
      ...defaultCharacterInput,
      campaignId,
      fatePoints: 3,
    });

    await identity.mutation(api.characters.spendFatePoint, {
      characterId: characterId as Id<"characters">,
      reason: "Invocação de aspecto",
    });

    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query("characterEditLogs")
        .withIndex("by_character", (q) => q.eq("characterId", characterId as Id<"characters">))
        .collect();

      expect(logs).toHaveLength(1);
      expect(logs[0].field).toBe("fatePoints");
      expect(logs[0].oldValue).toBe(3);
      expect(logs[0].newValue).toBe(2);
      expect(logs[0].reason).toBe("Invocação de aspecto");
      expect(typeof logs[0].timestamp).toBe("number");
    });
  });
});
