/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupCampaign(t: ReturnType<typeof convexTest>) {
  const identity = t.withIdentity({ tokenIdentifier: "token|msg001", email: "msg001@test.com" });
  await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });
  const campaignId = await identity.mutation(api.campaigns.createCampaign, {
    name: "Campanha de Teste",
    premise: "Uma aventura épica.",
    tone: "dark fantasy",
    expectedDuration: "medium",
  });
  return { identity, campaignId: campaignId as Id<"campaigns"> };
}

describe("messages.createMessage", () => {
  it("duas chamadas com mesmo clientMessageId resultam em exatamente um registro", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupCampaign(t);

    const args = {
      campaignId,
      role: "gm" as const,
      content: "Bem-vindos à taverna.",
      clientMessageId: "client-abc-123",
    };

    await identity.mutation(api.messages.createMessage, args);
    await identity.mutation(api.messages.createMessage, args);

    await t.run(async (ctx) => {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_campaign_and_clientMessageId", (q) =>
          q.eq("campaignId", campaignId).eq("clientMessageId", "client-abc-123"),
        )
        .collect();
      expect(messages).toHaveLength(1);
    });
  });

  it("cria documento com todos os campos corretos e status pending", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupCampaign(t);

    const id = await identity.mutation(api.messages.createMessage, {
      campaignId,
      role: "player" as const,
      content: "Eu ataco o goblin!",
      clientMessageId: "client-xyz-456",
    });

    await t.run(async (ctx) => {
      const msg = await ctx.db.get(id as Id<"messages">);
      expect(msg).not.toBeNull();
      expect(msg!.campaignId).toBe(campaignId);
      expect(msg!.role).toBe("player");
      expect(msg!.content).toBe("Eu ataco o goblin!");
      expect(msg!.clientMessageId).toBe("client-xyz-456");
      expect(msg!.status).toBe("pending");
    });
  });

  it("clientMessageId diferente na mesma campanha cria dois registros distintos", async () => {
    const t = convexTest(schema, modules);
    const { identity, campaignId } = await setupCampaign(t);

    await identity.mutation(api.messages.createMessage, {
      campaignId,
      role: "gm" as const,
      content: "Primeira mensagem.",
      clientMessageId: "client-001",
    });

    await identity.mutation(api.messages.createMessage, {
      campaignId,
      role: "gm" as const,
      content: "Segunda mensagem.",
      clientMessageId: "client-002",
    });

    await t.run(async (ctx) => {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .collect();
      expect(messages).toHaveLength(2);
    });
  });
});
