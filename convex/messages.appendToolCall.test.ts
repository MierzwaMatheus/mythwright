/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupCampaignAndMessage(t: ReturnType<typeof convexTest>) {
  const identity = t.withIdentity({ tokenIdentifier: "token|tc001", email: "tc001@test.com" });
  await identity.mutation(api.users.upsertFromAuth, { displayName: "GM" });
  const campaignId = await identity.mutation(api.campaigns.createCampaign, {
    name: "Campanha ToolCall",
    premise: "Uma aventura com tools.",
    tone: "dark fantasy",
    expectedDuration: "medium",
  });

  const messageId = await identity.mutation(api.messages.createMessage, {
    campaignId: campaignId as Id<"campaigns">,
    role: "gm" as const,
    content: "Mensagem com tool calls.",
    clientMessageId: "client-tc-001",
  });

  return { identity, campaignId: campaignId as Id<"campaigns">, messageId: messageId as Id<"messages"> };
}

describe("messages.appendToolCall", () => {
  it("múltiplas tool calls acumulam no array em ordem", async () => {
    const t = convexTest(schema, modules);
    const { identity, messageId } = await setupCampaignAndMessage(t);

    await identity.mutation(api.messages.appendToolCall, {
      messageId,
      toolName: "rollDice",
      toolParams: { sides: 6 },
      toolResult: { result: 4 },
    });

    await identity.mutation(api.messages.appendToolCall, {
      messageId,
      toolName: "lookupEntity",
      toolParams: { name: "Goblin" },
      toolResult: { found: true, id: "entity-123" },
    });

    await identity.mutation(api.messages.appendToolCall, {
      messageId,
      toolName: "rollDice",
      toolParams: { sides: 20 },
      toolResult: { result: 17 },
    });

    await t.run(async (ctx) => {
      const msg = await ctx.db.get(messageId);
      expect(msg).not.toBeNull();
      expect(msg!.toolCalls).toHaveLength(3);

      expect(msg!.toolCalls![0].toolName).toBe("rollDice");
      expect(msg!.toolCalls![0].toolParams).toEqual({ sides: 6 });
      expect(msg!.toolCalls![0].toolResult).toEqual({ result: 4 });
      expect(typeof msg!.toolCalls![0].executedAt).toBe("number");

      expect(msg!.toolCalls![1].toolName).toBe("lookupEntity");
      expect(msg!.toolCalls![1].toolParams).toEqual({ name: "Goblin" });

      expect(msg!.toolCalls![2].toolName).toBe("rollDice");
      expect(msg!.toolCalls![2].toolParams).toEqual({ sides: 20 });
    });
  });

  it("a mensagem pode ser recuperada com todas as tool calls após múltiplos appends", async () => {
    const t = convexTest(schema, modules);
    const { identity, messageId } = await setupCampaignAndMessage(t);

    await identity.mutation(api.messages.appendToolCall, {
      messageId,
      toolName: "checkWeather",
      toolParams: { location: "Neverwinter" },
      toolResult: { weather: "stormy" },
    });

    await t.run(async (ctx) => {
      const msg = await ctx.db.get(messageId);
      expect(msg!.toolCalls).toHaveLength(1);
      expect(msg!.toolCalls![0].toolName).toBe("checkWeather");
      expect(msg!.toolCalls![0].toolResult).toEqual({ weather: "stormy" });
    });
  });

  it("lança erro ao tentar appendar tool call em messageId inexistente", async () => {
    const t = convexTest(schema, modules);
    const { identity, messageId } = await setupCampaignAndMessage(t);

    await t.run(async (ctx) => {
      await ctx.db.delete(messageId);
    });

    await expect(
      identity.mutation(api.messages.appendToolCall, {
        messageId,
        toolName: "rollDice",
        toolParams: { sides: 6 },
        toolResult: { result: 3 },
      }),
    ).rejects.toThrow();
  });
});
