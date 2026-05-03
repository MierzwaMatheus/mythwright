import { describe, it, expect } from "vitest";
import { buildSceneSummarizerPrompt, parseSceneSummarizerResponse } from "./sceneSummarizer";

describe("buildSceneSummarizerPrompt", () => {
  it("inclui o título da cena no prompt", () => {
    const prompt = buildSceneSummarizerPrompt(
      "A Taverna dos Lamentos",
      "Uma taverna escura no sul da cidade",
      "[Jogador]: Entro na taverna.\n[GM]: A taverna está vazia.",
    );
    expect(prompt).toContain("A Taverna dos Lamentos");
  });

  it("inclui a descrição da cena no prompt", () => {
    const prompt = buildSceneSummarizerPrompt(
      "A Taverna dos Lamentos",
      "Uma taverna escura no sul da cidade",
      "[Jogador]: Entro na taverna.\n[GM]: A taverna está vazia.",
    );
    expect(prompt).toContain("Uma taverna escura no sul da cidade");
  });

  it("inclui o bloco de mensagens no prompt", () => {
    const prompt = buildSceneSummarizerPrompt(
      "A Taverna dos Lamentos",
      "Uma taverna escura no sul da cidade",
      "[Jogador]: Entro na taverna.\n[GM]: A taverna está vazia.",
    );
    expect(prompt).toContain("[Jogador]: Entro na taverna.");
    expect(prompt).toContain("[GM]: A taverna está vazia.");
  });

  it("contém as instruções de formato", () => {
    const prompt = buildSceneSummarizerPrompt("Cena X", "Desc Y", "Msgs Z");
    expect(prompt).toContain("200-400 palavras");
    expect(prompt).toContain("4 parágrafos");
  });

  it("instrui a não incluir títulos de seção no output", () => {
    const prompt = buildSceneSummarizerPrompt("Cena X", "Desc Y", "Msgs Z");
    expect(prompt).toContain("sem títulos de seção");
  });
});

describe("parseSceneSummarizerResponse", () => {
  it("retorna o texto bruto sem modificação", () => {
    const raw = "Este é o resumo da cena. Aconteceu algo importante.";
    expect(parseSceneSummarizerResponse(raw)).toBe(raw);
  });

  it("retorna string vazia quando recebe string vazia", () => {
    expect(parseSceneSummarizerResponse("")).toBe("");
  });

  it("preserva quebras de linha no texto", () => {
    const raw = "Parágrafo um.\n\nParágrafo dois.";
    expect(parseSceneSummarizerResponse(raw)).toBe(raw);
  });
});
