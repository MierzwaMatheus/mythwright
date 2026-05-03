/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import schema from "./schema";

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

  return { identity, campaignId: campaignId as import("./_generated/dataModel").Id<"campaigns"> };
}

describe("getLlmConfig", () => {
  it("retorna defaults open-source quando llmConfig ausente na campaign", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|llm001", "llm001@test.com");

    const config = await t.run(async (ctx) => {
      const { getLlmConfig } = await import("./lib/llmConfig");
      return await getLlmConfig(ctx, campaignId);
    });

    expect(config.narrativeModel).toBe("deepseek/deepseek-chat-v3-0324");
    expect(config.utilityModel).toBe("meta-llama/llama-3.1-8b-instruct");
    expect(config.extractionModel).toBe("meta-llama/llama-3.1-8b-instruct");
    expect(config.embeddingModel).toBe("baai/bge-m3");
  });

  it("respeita override por campanha quando llmConfig presente", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|llm002", "llm002@test.com");

    const customConfig = {
      narrativeModel: "openai/gpt-4o",
      utilityModel: "openai/gpt-4o-mini",
      extractionModel: "openai/gpt-4o-mini",
      embeddingModel: "openai/text-embedding-3-small",
    };

    await t.run(async (ctx) => {
      await ctx.db.patch(campaignId, { llmConfig: customConfig });
    });

    const config = await t.run(async (ctx) => {
      const { getLlmConfig } = await import("./lib/llmConfig");
      return await getLlmConfig(ctx, campaignId);
    });

    expect(config.narrativeModel).toBe("openai/gpt-4o");
    expect(config.utilityModel).toBe("openai/gpt-4o-mini");
    expect(config.extractionModel).toBe("openai/gpt-4o-mini");
    expect(config.embeddingModel).toBe("openai/text-embedding-3-small");
  });
});
