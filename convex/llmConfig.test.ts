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

    expect(config.narrativeModel).toBe("deepseek/deepseek-chat");
    expect(config.utilityModel).toBe("meta-llama/llama-3.1-8b-instruct");
    expect(config.extractionModel).toBe("qwen/qwen-2.5-32b-instruct");
    expect(config.embeddingModel).toBe("BAAI/bge-m3");
  });

  it("merge com defaults preserva campos nao sobrescritos", async () => {
    // Garante que getLlmConfig faz { ...DEFAULT_LLM_CONFIG, ...campaign.llmConfig }
    // e nao apenas retorna campaign.llmConfig puro (que perderia defaults se
    // alguem gravar um objeto sem todos os campos no futuro).
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|llm003", "llm003@test.com");

    // Salva apenas narrativeModel diferente, o resto igual ao default
    await t.run(async (ctx) => {
      await ctx.db.patch(campaignId, {
        llmConfig: {
          narrativeModel: "openai/gpt-4o",
          utilityModel: "meta-llama/llama-3.1-8b-instruct",
          extractionModel: "qwen/qwen-2.5-32b-instruct",
          embeddingModel: "BAAI/bge-m3",
        },
      });
    });

    const config = await t.run(async (ctx) => {
      const { getLlmConfig } = await import("./lib/llmConfig");
      return await getLlmConfig(ctx, campaignId);
    });

    // narrativeModel foi customizado, deve retornar o customizado
    expect(config.narrativeModel).toBe("openai/gpt-4o");
    // os outros nao foram alterados, devem retornar os defaults
    expect(config.utilityModel).toBe("meta-llama/llama-3.1-8b-instruct");
    expect(config.extractionModel).toBe("qwen/qwen-2.5-32b-instruct");
    expect(config.embeddingModel).toBe("BAAI/bge-m3");
  });

  it("merge: campo ausente na campaign usa default", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await setupUserAndCampaign(t, "token|llm004", "llm004@test.com");

    // Patch with partial config (only narrativeModel)
    await t.run(async (ctx) => {
      await ctx.db.patch(campaignId, {
        llmConfig: { narrativeModel: "custom/model" },
      });
    });

    const config = await t.run(async (ctx) => {
      const { getLlmConfig } = await import("./lib/llmConfig");
      return await getLlmConfig(ctx, campaignId);
    });

    expect(config.narrativeModel).toBe("custom/model");
    expect(config.utilityModel).toBe("meta-llama/llama-3.1-8b-instruct");
    expect(config.extractionModel).toBe("qwen/qwen-2.5-32b-instruct");
    expect(config.embeddingModel).toBe("BAAI/bge-m3");
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
