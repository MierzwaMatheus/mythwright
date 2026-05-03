/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupCampaignAndScene(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "test@test.com",
      displayName: "Teste",
      tokenIdentifier: "token|test",
    });

    const campaignId = await ctx.db.insert("campaigns", {
      userId,
      name: "Campanha Teste",
      premise: "Premissa",
      tone: "dark",
      expectedDuration: "medium",
      status: "active",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    });

    const sceneId = await ctx.db.insert("scenes", {
      campaignId,
      title: "Cena Teste",
      status: "active",
      createdAt: Date.now(),
    });

    return { campaignId, sceneId };
  });
}

describe("messages.getMessagesByScene", () => {
  it("primeira pagina retorna 50 de 60 mensagens e segunda retorna 10 com isDone true", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, sceneId } = await setupCampaignAndScene(t);

    await t.run(async (ctx) => {
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert("messages", {
          campaignId,
          sceneId,
          role: "player",
          content: `Mensagem ${i}`,
          clientMessageId: `client-${i}`,
          status: "complete",
          createdAt: Date.now() + i,
        });
      }
    });

    const firstPage = await t.query(api.messages.getMessagesByScene, {
      sceneId,
      paginationOpts: { numItems: 50, cursor: null },
    });

    expect(firstPage.page).toHaveLength(50);
    expect(firstPage.isDone).toBe(false);
    expect(typeof firstPage.continueCursor).toBe("string");

    const secondPage = await t.query(api.messages.getMessagesByScene, {
      sceneId,
      paginationOpts: { numItems: 50, cursor: firstPage.continueCursor },
    });

    expect(secondPage.page).toHaveLength(10);
    expect(secondPage.isDone).toBe(true);
  });

  it("cena sem mensagens retorna pagina vazia com isDone true", async () => {
    const t = convexTest(schema, modules);
    const { sceneId } = await setupCampaignAndScene(t);

    const result = await t.query(api.messages.getMessagesByScene, {
      sceneId,
      paginationOpts: { numItems: 50, cursor: null },
    });

    expect(result.page).toHaveLength(0);
    expect(result.isDone).toBe(true);
  });

  it("mensagens ordenadas por createdAt asc", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, sceneId } = await setupCampaignAndScene(t);

    const base = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "player",
        content: "Terceira",
        clientMessageId: "client-3",
        status: "complete",
        createdAt: base + 200,
      });
      await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "gm",
        content: "Primeira",
        clientMessageId: "client-1",
        status: "complete",
        createdAt: base + 0,
      });
      await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "player",
        content: "Segunda",
        clientMessageId: "client-2",
        status: "complete",
        createdAt: base + 100,
      });
    });

    const result = await t.query(api.messages.getMessagesByScene, {
      sceneId,
      paginationOpts: { numItems: 50, cursor: null },
    });

    expect(result.page[0].content).toBe("Primeira");
    expect(result.page[1].content).toBe("Segunda");
    expect(result.page[2].content).toBe("Terceira");
  });

  it("nao retorna mensagens de outra cena", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, sceneId } = await setupCampaignAndScene(t);

    const outraSceneId = await t.run(async (ctx) => {
      return await ctx.db.insert("scenes", {
        campaignId,
        title: "Outra Cena",
        status: "inactive",
        createdAt: Date.now(),
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        campaignId,
        sceneId,
        role: "player",
        content: "Mensagem da cena correta",
        clientMessageId: "client-c1",
        status: "complete",
        createdAt: Date.now(),
      });
      await ctx.db.insert("messages", {
        campaignId,
        sceneId: outraSceneId,
        role: "player",
        content: "Mensagem de outra cena",
        clientMessageId: "client-o1",
        status: "complete",
        createdAt: Date.now(),
      });
    });

    const result = await t.query(api.messages.getMessagesByScene, {
      sceneId,
      paginationOpts: { numItems: 50, cursor: null },
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0].content).toBe("Mensagem da cena correta");
  });
});
