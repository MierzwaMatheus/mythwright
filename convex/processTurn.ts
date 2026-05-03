import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GM_MODEL = "openai/gpt-4o-mini";
const MAX_REGENERATIONS = 2; // 3 tentativas no total (0, 1, 2)

async function callLlm(playerMessageContent: string): Promise<string> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GM_MODEL,
      messages: [{ role: "user", content: playerMessageContent }],
    }),
  });
  const data = await response.json();
  return data.choices[0].message.content as string;
}

export const markMessageStatus = internalMutation({
  args: {
    messageId: v.id("messages"),
    status: v.union(v.literal("pending"), v.literal("complete"), v.literal("failed"), v.literal("leaked")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { status: args.status });
  },
});

export const createGmMessage = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    content: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"messages">> => {
    return await ctx.db.insert("messages", {
      campaignId: args.campaignId,
      role: "gm",
      content: args.content,
      clientMessageId: "gm-" + Date.now() + "-" + Math.random(),
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const processTurn = internalAction({
  args: {
    campaignId: v.id("campaigns"),
    hiddenFacts: v.array(v.object({ id: v.string(), content: v.string() })),
    playerMessageContent: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: true; messageId: Id<"messages"> } | { success: false; reason: string }> => {
    for (let attempt = 0; attempt <= MAX_REGENERATIONS; attempt++) {
      const gmContent = await callLlm(args.playerMessageContent);

      const messageId: Id<"messages"> = await ctx.runMutation(internal.processTurn.createGmMessage, {
        campaignId: args.campaignId,
        content: gmContent,
      });

      const leakResult = await ctx.runAction(internal.prompts.antiLeak.validateAntiLeak, {
        messageId,
        hiddenFacts: args.hiddenFacts,
      });

      if (!leakResult.vazou) {
        await ctx.runMutation(internal.processTurn.markMessageStatus, {
          messageId,
          status: "complete",
        });
        return { success: true, messageId };
      }

      if (attempt < MAX_REGENERATIONS) {
        await ctx.runMutation(internal.processTurn.markMessageStatus, {
          messageId,
          status: "leaked",
        });
      } else {
        await ctx.runMutation(internal.processTurn.markMessageStatus, {
          messageId,
          status: "failed",
        });
        return { success: false, reason: "max_regenerations_exceeded" };
      }
    }
    return { success: false, reason: "max_regenerations_exceeded" };
  },
});
