/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";
import { ConvexError } from "convex/values";

type ChildTable =
  | "characters"
  | "scenes"
  | "messages"
  | "entities"
  | "facts"
  | "triggers"
  | "summaries"
  | "diceRolls";

const modules = import.meta.glob("./**/*.ts");

describe("campaigns.createCampaign", () => {
  const campaignInput = {
    name: "A Maldição de Ironveil",
    premise: "Heróis investigam desaparecimentos numa cidade mineira.",
    tone: "dark fantasy",
    expectedDuration: "medium" as const,
  };

  it("retorna um ID válido ao criar campanha", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|c001", email: "gm@mythwright.com" });

    await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });
    const id = await identity.mutation(api.campaigns.createCampaign, campaignInput);

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("persiste status 'setup' automaticamente", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|c002", email: "gm2@mythwright.com" });

    await identity.mutation(api.users.upsertFromAuth, { displayName: "GM2" });
    const id = await identity.mutation(api.campaigns.createCampaign, campaignInput);

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(id as Id<"campaigns">);
      expect(campaign).not.toBeNull();
      expect(campaign!.status).toBe("setup");
    });
  });

  it("persiste userId do usuário autenticado (não recebido como argumento)", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|c003", email: "gm3@mythwright.com" });

    await identity.mutation(api.users.upsertFromAuth, { displayName: "GM3" });
    const id = await identity.mutation(api.campaigns.createCampaign, campaignInput);

    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", "token|c003"))
        .unique();
      const campaign = await ctx.db.get(id as Id<"campaigns">);
      expect(campaign).not.toBeNull();
      expect(campaign!.userId).toBe(user!._id);
    });
  });

  it("lança erro quando não autenticado", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.campaigns.createCampaign, campaignInput)
    ).rejects.toThrow();
  });

  it("persiste createdAt e lastActivityAt como números (timestamps)", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|c005", email: "gm5@mythwright.com" });

    await identity.mutation(api.users.upsertFromAuth, { displayName: "GM5" });
    const id = await identity.mutation(api.campaigns.createCampaign, campaignInput);

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(id as Id<"campaigns">);
      expect(campaign).not.toBeNull();
      expect(typeof campaign!.createdAt).toBe("number");
      expect(typeof campaign!.lastActivityAt).toBe("number");
      expect(campaign!.createdAt).toBeGreaterThan(0);
      expect(campaign!.lastActivityAt).toBeGreaterThan(0);
    });
  });
});

describe("campaigns.listCampaigns", () => {
  const campaignInput = {
    name: "A Maldição de Ironveil",
    premise: "Heróis investigam desaparecimentos numa cidade mineira.",
    tone: "dark fantasy",
    expectedDuration: "medium" as const,
  };

  it("retorna campanhas do usuário autenticado", async () => {
    const t = convexTest(schema, modules);
    const identityA = t.withIdentity({ tokenIdentifier: "userA|list001", email: "a@test.com" });

    await identityA.mutation(api.users.upsertFromAuth, { displayName: "User A" });
    await identityA.mutation(api.campaigns.createCampaign, { ...campaignInput, name: "Campanha 1" });
    await identityA.mutation(api.campaigns.createCampaign, { ...campaignInput, name: "Campanha 2" });

    const result = await identityA.query(api.campaigns.listCampaigns, {});

    expect(result).toHaveLength(2);
  });

  it("ordena campanhas por lastActivityAt desc", async () => {
    const t = convexTest(schema, modules);
    const identityA = t.withIdentity({ tokenIdentifier: "userA|list002", email: "a2@test.com" });

    await identityA.mutation(api.users.upsertFromAuth, { displayName: "User A2" });
    const id1 = await identityA.mutation(api.campaigns.createCampaign, { ...campaignInput, name: "Antiga" });
    const id2 = await identityA.mutation(api.campaigns.createCampaign, { ...campaignInput, name: "Nova" });

    await t.run(async (ctx) => {
      await ctx.db.patch(id1 as Id<"campaigns">, { lastActivityAt: 1000 });
      await ctx.db.patch(id2 as Id<"campaigns">, { lastActivityAt: 2000 });
    });

    const result = await identityA.query(api.campaigns.listCampaigns, {});

    expect(result[0].name).toBe("Nova");
    expect(result[1].name).toBe("Antiga");
  });

  it("nunca retorna campanhas de outro usuário", async () => {
    const t = convexTest(schema, modules);
    const identityA = t.withIdentity({ tokenIdentifier: "userA|list003", email: "a3@test.com" });
    const identityB = t.withIdentity({ tokenIdentifier: "userB|list003", email: "b3@test.com" });

    await identityA.mutation(api.users.upsertFromAuth, { displayName: "User A3" });
    await identityB.mutation(api.users.upsertFromAuth, { displayName: "User B3" });

    await identityA.mutation(api.campaigns.createCampaign, { ...campaignInput, name: "Campanha de A" });
    await identityB.mutation(api.campaigns.createCampaign, { ...campaignInput, name: "Campanha de B" });

    const resultA = await identityA.query(api.campaigns.listCampaigns, {});

    expect(resultA).toHaveLength(1);
    expect(resultA[0].name).toBe("Campanha de A");
  });

  it("retorna lista vazia quando não há campanhas", async () => {
    const t = convexTest(schema, modules);
    const identityA = t.withIdentity({ tokenIdentifier: "userA|list004", email: "a4@test.com" });

    await identityA.mutation(api.users.upsertFromAuth, { displayName: "User A4" });

    const result = await identityA.query(api.campaigns.listCampaigns, {});

    expect(result).toEqual([]);
  });

  it("lança erro quando não autenticado", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.query(api.campaigns.listCampaigns, {})
    ).rejects.toThrow();
  });
});

describe("campaigns.updateCampaignStatus", () => {
  const campaignInput = {
    name: "A Maldição de Ironveil",
    premise: "Heróis investigam desaparecimentos numa cidade mineira.",
    tone: "dark fantasy",
    expectedDuration: "medium" as const,
  };

  async function setupUserAndCampaign(t: ReturnType<typeof convexTest>, tokenIdentifier: string, email: string) {
    const identity = t.withIdentity({ tokenIdentifier, email });
    await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });
    const campaignId = await identity.mutation(api.campaigns.createCampaign, campaignInput);
    return { identity, campaignId: campaignId as Id<"campaigns"> };
  }

  it("transição setup → active é válida", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|u001", "u001@test.com");

    await expect(
      identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "active" })
    ).resolves.not.toThrow();

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId);
      expect(campaign!.status).toBe("active");
    });
  });

  it("transição active → paused é válida", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|u002", "u002@test.com");

    await identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "active" });
    await expect(
      identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "paused" })
    ).resolves.not.toThrow();

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId);
      expect(campaign!.status).toBe("paused");
    });
  });

  it("transição paused → active é válida", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|u003", "u003@test.com");

    await identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "active" });
    await identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "paused" });
    await expect(
      identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "active" })
    ).resolves.not.toThrow();

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId);
      expect(campaign!.status).toBe("active");
    });
  });

  it("transição active → archived é válida", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|u004", "u004@test.com");

    await identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "active" });
    await expect(
      identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "archived" })
    ).resolves.not.toThrow();

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId);
      expect(campaign!.status).toBe("archived");
    });
  });

  it("transição paused → archived é válida", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|u005", "u005@test.com");

    await identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "active" });
    await identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "paused" });
    await expect(
      identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "archived" })
    ).resolves.not.toThrow();

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId);
      expect(campaign!.status).toBe("archived");
    });
  });

  it("atualiza lastActivityAt após transição", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|u006", "u006@test.com");

    const beforeUpdate = await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId);
      return campaign!.lastActivityAt;
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(campaignId, { lastActivityAt: 1000 });
    });

    await identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "active" });

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId);
      expect(campaign!.lastActivityAt).toBeGreaterThan(1000);
    });
  });

  it("archived → active lança ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|u007", "u007@test.com");

    await identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "active" });
    await identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "archived" });

    await expect(
      identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "active" })
    ).rejects.toThrow(ConvexError);
  });

  it("archived → paused lança ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|u008", "u008@test.com");

    await identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "active" });
    await identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "archived" });

    await expect(
      identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "paused" })
    ).rejects.toThrow(ConvexError);
  });

  it("setup → paused lança ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|u009", "u009@test.com");

    await expect(
      identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "paused" })
    ).rejects.toThrow(ConvexError);
  });

  it("setup → archived lança ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|u010", "u010@test.com");

    await expect(
      identity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "archived" })
    ).rejects.toThrow(ConvexError);
  });

  it("campanha não encontrada lança ConvexError", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|u011", email: "u011@test.com" });
    await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });

    const fakeCampaignId = "fake_campaign_id" as Id<"campaigns">;

    await expect(
      identity.mutation(api.campaigns.updateCampaignStatus, { campaignId: fakeCampaignId, newStatus: "active" })
    ).rejects.toThrow();
  });

  it("usuário não autenticado lança ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|u012", "u012@test.com");

    await expect(
      t.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "active" })
    ).rejects.toThrow(ConvexError);
  });

  it("usuário não dono da campanha lança ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|u013", "u013@test.com");

    const otherIdentity = t.withIdentity({ tokenIdentifier: "token|u013b", email: "u013b@test.com" });
    await otherIdentity.mutation(api.users.upsertFromAuth, { displayName: "Other GM" });

    await expect(
      otherIdentity.mutation(api.campaigns.updateCampaignStatus, { campaignId, newStatus: "active" })
    ).rejects.toThrow(ConvexError);
  });
});

describe("campaigns.updateCampaignConfig", () => {
  const campaignInput = {
    name: "Campanha de Config",
    premise: "Premissa original.",
    tone: "epic fantasy",
    expectedDuration: "long" as const,
  };

  async function setupUserAndCampaign(
    t: ReturnType<typeof convexTest>,
    tokenIdentifier: string,
    email: string,
  ) {
    const identity = t.withIdentity({ tokenIdentifier, email });
    await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });
    const campaignId = await identity.mutation(api.campaigns.createCampaign, campaignInput);
    return { identity, campaignId: campaignId as Id<"campaigns"> };
  }

  it("atualiza apenas tone quando só tone é fornecido", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|cfg001", "cfg001@test.com");

    await identity.mutation(api.campaigns.updateCampaignConfig, {
      campaignId,
      tone: "dark horror",
    });

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId);
      expect(campaign!.tone).toBe("dark horror");
      expect(campaign!.premise).toBe("Premissa original.");
    });
  });

  it("atualiza apenas premise quando só premise é fornecida", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|cfg002", "cfg002@test.com");

    await identity.mutation(api.campaigns.updateCampaignConfig, {
      campaignId,
      premise: "Nova premissa.",
    });

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId);
      expect(campaign!.premise).toBe("Nova premissa.");
      expect(campaign!.tone).toBe("epic fantasy");
    });
  });

  it("atualiza cheatModeEnabled para true", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|cfg003", "cfg003@test.com");

    await identity.mutation(api.campaigns.updateCampaignConfig, {
      campaignId,
      cheatModeEnabled: true,
    });

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId);
      expect(campaign!.cheatModeEnabled).toBe(true);
    });
  });

  it("atualiza antiLeakValidationEnabled para false", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|cfg004", "cfg004@test.com");

    await identity.mutation(api.campaigns.updateCampaignConfig, {
      campaignId,
      antiLeakValidationEnabled: false,
    });

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId);
      expect(campaign!.antiLeakValidationEnabled).toBe(false);
    });
  });

  it("atualiza múltiplos campos em uma chamada", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|cfg005", "cfg005@test.com");

    await identity.mutation(api.campaigns.updateCampaignConfig, {
      campaignId,
      tone: "comedic",
      premise: "Aventura hilária.",
      cheatModeEnabled: true,
      antiLeakValidationEnabled: true,
    });

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId);
      expect(campaign!.tone).toBe("comedic");
      expect(campaign!.premise).toBe("Aventura hilária.");
      expect(campaign!.cheatModeEnabled).toBe(true);
      expect(campaign!.antiLeakValidationEnabled).toBe(true);
    });
  });

  it("não altera campos não enviados", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|cfg006", "cfg006@test.com");

    await identity.mutation(api.campaigns.updateCampaignConfig, {
      campaignId,
      tone: "grim",
    });

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId);
      expect(campaign!.premise).toBe("Premissa original.");
      expect(campaign!.name).toBe("Campanha de Config");
      expect(campaign!.expectedDuration).toBe("long");
      expect(campaign!.status).toBe("setup");
    });
  });

  it("lança erro se campanha não encontrada", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|cfg007", email: "cfg007@test.com" });
    await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });

    const fakeId = "fake_campaign_id" as Id<"campaigns">;

    await expect(
      identity.mutation(api.campaigns.updateCampaignConfig, {
        campaignId: fakeId,
        tone: "dark",
      })
    ).rejects.toThrow();
  });

  it("lança erro se não autenticado", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|cfg008", "cfg008@test.com");

    await expect(
      t.mutation(api.campaigns.updateCampaignConfig, {
        campaignId,
        tone: "dark",
      })
    ).rejects.toThrow(ConvexError);
  });

  it("lança erro se campanha pertence a outro usuário", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|cfg009", "cfg009@test.com");

    const other = t.withIdentity({ tokenIdentifier: "token|cfg009b", email: "cfg009b@test.com" });
    await other.mutation(api.users.upsertFromAuth, { displayName: "Outro GM" });

    await expect(
      other.mutation(api.campaigns.updateCampaignConfig, {
        campaignId,
        tone: "dark",
      })
    ).rejects.toThrow(ConvexError);
  });
});

describe("campaigns.deleteCampaign", () => {
  const campaignInput = {
    name: "Campanha para deletar",
    premise: "Será deletada.",
    tone: "dark",
    expectedDuration: "one-shot" as const,
  };

  const childTables: ChildTable[] = [
    "characters",
    "scenes",
    "messages",
    "entities",
    "facts",
    "triggers",
    "summaries",
    "diceRolls",
  ];

  async function setupUserAndCampaign(
    t: ReturnType<typeof convexTest>,
    tokenIdentifier: string,
    email: string,
  ) {
    const identity = t.withIdentity({ tokenIdentifier, email });
    await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });
    const campaignId = await identity.mutation(api.campaigns.createCampaign, campaignInput);
    return { identity, campaignId: campaignId as Id<"campaigns"> };
  }

  it("deleta a campanha sem lançar erro", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|d001", "d001@test.com");

    await expect(
      identity.mutation(api.campaigns.deleteCampaign, { campaignId })
    ).resolves.not.toThrow();

    await t.run(async (ctx) => {
      const campaign = await ctx.db.get(campaignId);
      expect(campaign).toBeNull();
    });
  });

  it("deleta todos os registros filhos em cascata", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|d002", "d002@test.com");

    await t.run(async (ctx) => {
      for (const table of childTables) {
        if (table === "characters") {
          await ctx.db.insert(table, {
            campaignId,
            name: "Personagem Teste",
            aspects: [],
            skills: {},
            stunts: [],
            fatePoints: 3,
            stress: { physical: [], mental: [] },
            consequences: [],
          });
        } else if (table === "entities") {
          await ctx.db.insert(table, {
            campaignId,
            type: "npc",
            name: "Entidade Teste",
            visibility: "known",
            description: "Descrição de teste.",
          });
        } else if (table === "facts") {
          await ctx.db.insert(table, {
            campaignId,
            content: "Fato de teste.",
            visibility: "known",
          });
        } else {
          await ctx.db.insert(table, { campaignId });
        }
      }
    });

    await identity.mutation(api.campaigns.deleteCampaign, { campaignId });

    await t.run(async (ctx) => {
      for (const table of childTables) {
        const rows = await ctx.db
          .query(table)
          .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
          .collect();
        expect(rows).toHaveLength(0);
      }
    });
  });

  it("deleta campanha sem registros filhos sem erro", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupUserAndCampaign(t, "token|d003", "d003@test.com");

    await expect(
      identity.mutation(api.campaigns.deleteCampaign, { campaignId })
    ).resolves.not.toThrow();
  });

  it("usuário não autenticado lança ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|d004", "d004@test.com");

    await expect(
      t.mutation(api.campaigns.deleteCampaign, { campaignId })
    ).rejects.toThrow(ConvexError);
  });

  it("usuário não dono lança ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|d005", "d005@test.com");

    const other = t.withIdentity({ tokenIdentifier: "token|d005b", email: "d005b@test.com" });
    await other.mutation(api.users.upsertFromAuth, { displayName: "Other" });

    await expect(
      other.mutation(api.campaigns.deleteCampaign, { campaignId })
    ).rejects.toThrow(ConvexError);
  });

  it("campanha inexistente lança ConvexError", async () => {
    const t = convexTest(schema, modules);
    const identity = t.withIdentity({ tokenIdentifier: "token|d006", email: "d006@test.com" });
    await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });

    const fakeId = "fake_campaign_id" as Id<"campaigns">;
    await expect(
      identity.mutation(api.campaigns.deleteCampaign, { campaignId: fakeId })
    ).rejects.toThrow();
  });
});
