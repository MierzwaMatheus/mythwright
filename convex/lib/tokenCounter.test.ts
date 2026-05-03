import { describe, test, expect, vi, afterEach } from "vitest";
import { estimateTokenCount } from "./tokenCounter";
import { buildFullContext } from "./contextBuilder";

describe("estimateTokenCount", () => {
  test("estima tokens corretamente com heurística 1 token = 4 chars", () => {
    expect(estimateTokenCount("")).toBe(0);
    expect(estimateTokenCount("abcd")).toBe(1);
    expect(estimateTokenCount("abcde")).toBe(2);
    expect(estimateTokenCount("a".repeat(100))).toBe(25);
  });
});

describe("buildFullContext token warning", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("emite console.warn quando contexto ultrapassa 14k tokens", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // 14.000 tokens * 4 chars/token = 56.000 chars para ultrapassar o limite
    const longContent = "x".repeat(60_000);

    const campaign = { name: "Test Campaign", systemPrompt: longContent };
    const character = {
      name: "Hero",
      aspects: [],
      skills: {},
      stunts: [],
      fatePoints: 3,
      stress: { physical: [], mental: [] },
      consequences: [],
    };
    const scene = { title: "Scene", status: "active" as const };
    const messages = [{ role: "user" as const, content: "Hello" }];
    const retrievedFacts: never[] = [];
    const retrievedSummaries = [{ content: longContent }];
    const firedEvents: never[] = [];

    buildFullContext(campaign, character, scene, messages, retrievedFacts, retrievedSummaries, firedEvents);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/tokens|14k/i)
    );
  });
});
