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
  aspects: ["Mago errante"],
  skills: { Fight: 3 },
  stunts: [],
  stress: {
    physical: [false, false, false],
    mental: [false, false],
  },
};

async function setupUserCampaignAndCharacter(
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
  }) as Id<"campaigns">;

  const characterId = await identity.mutation(api.characters.createCharacter, {
    ...defaultCharacterInput,
    campaignId,
  }) as Id<"characters">;

  return { identity, campaignId, characterId };
}

describe("consequences.addConsequence", () => {
  it("adiciona consequência mild e persiste no personagem", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupUserCampaignAndCharacter(t, "token|con001", "con001@test.com");

    await identity.mutation(api.consequences.addConsequence, {
      characterId,
      severity: "mild",
      description: "Braço machucado",
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.consequences).toHaveLength(1);
      expect(character!.consequences[0].severity).toBe("mild");
      expect(character!.consequences[0].description).toBe("Braço machucado");
    });
  });

  it("adiciona consequência moderate e persiste no personagem", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupUserCampaignAndCharacter(t, "token|con002", "con002@test.com");

    await identity.mutation(api.consequences.addConsequence, {
      characterId,
      severity: "moderate",
      description: "Ferida profunda no abdômen",
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.consequences).toHaveLength(1);
      expect(character!.consequences[0].severity).toBe("moderate");
    });
  });

  it("adiciona consequência severe e persiste no personagem", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupUserCampaignAndCharacter(t, "token|con003", "con003@test.com");

    await identity.mutation(api.consequences.addConsequence, {
      characterId,
      severity: "severe",
      description: "Osso quebrado",
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.consequences).toHaveLength(1);
      expect(character!.consequences[0].severity).toBe("severe");
    });
  });

  it("acumula múltiplas consequências distintas", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupUserCampaignAndCharacter(t, "token|con004", "con004@test.com");

    await identity.mutation(api.consequences.addConsequence, {
      characterId,
      severity: "mild",
      description: "Arranhão",
    });

    await identity.mutation(api.consequences.addConsequence, {
      characterId,
      severity: "moderate",
      description: "Corte profundo",
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.consequences).toHaveLength(2);
    });
  });

  it("rejeita adicionar severity duplicada — já existe mild", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupUserCampaignAndCharacter(t, "token|con005", "con005@test.com");

    await identity.mutation(api.consequences.addConsequence, {
      characterId,
      severity: "mild",
      description: "Primeira consequência mild",
    });

    await expect(
      identity.mutation(api.consequences.addConsequence, {
        characterId,
        severity: "mild",
        description: "Segunda consequência mild",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("sem autenticacao — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { characterId } = await setupUserCampaignAndCharacter(t, "token|con006", "con006@test.com");

    await expect(
      t.mutation(api.consequences.addConsequence, {
        characterId,
        severity: "mild",
        description: "Sem auth",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("personagem de outra campanha — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { characterId } = await setupUserCampaignAndCharacter(t, "token|con007", "con007@test.com");

    const other = t.withIdentity({ tokenIdentifier: "token|con007b", email: "con007b@test.com" });
    await other.mutation(api.users.upsertFromAuth, { displayName: "Outro GM" });

    await expect(
      other.mutation(api.consequences.addConsequence, {
        characterId,
        severity: "mild",
        description: "Tentativa não autorizada",
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("consequences.clearConsequence", () => {
  it("remove consequência mild existente do personagem", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupUserCampaignAndCharacter(t, "token|cc001", "cc001@test.com");

    await identity.mutation(api.consequences.addConsequence, {
      characterId,
      severity: "mild",
      description: "Braço machucado",
    });

    await identity.mutation(api.consequences.clearConsequence, {
      characterId,
      severity: "mild",
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.consequences).toHaveLength(0);
    });
  });

  it("remove apenas a severidade especificada mantendo as demais", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupUserCampaignAndCharacter(t, "token|cc002", "cc002@test.com");

    await identity.mutation(api.consequences.addConsequence, {
      characterId,
      severity: "mild",
      description: "Arranhão",
    });

    await identity.mutation(api.consequences.addConsequence, {
      characterId,
      severity: "moderate",
      description: "Corte profundo",
    });

    await identity.mutation(api.consequences.clearConsequence, {
      characterId,
      severity: "mild",
    });

    await t.run(async (ctx) => {
      const character = await ctx.db.get(characterId);
      expect(character!.consequences).toHaveLength(1);
      expect(character!.consequences[0].severity).toBe("moderate");
    });
  });

  it("rejeita limpar severidade inexistente — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupUserCampaignAndCharacter(t, "token|cc003", "cc003@test.com");

    await expect(
      identity.mutation(api.consequences.clearConsequence, {
        characterId,
        severity: "mild",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("sem autenticacao — rejeita com ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { identity, characterId } = await setupUserCampaignAndCharacter(t, "token|cc004", "cc004@test.com");

    await identity.mutation(api.consequences.addConsequence, {
      characterId,
      severity: "mild",
      description: "Arranhão",
    });

    await expect(
      t.mutation(api.consequences.clearConsequence, {
        characterId,
        severity: "mild",
      }),
    ).rejects.toThrow(ConvexError);
  });
});
