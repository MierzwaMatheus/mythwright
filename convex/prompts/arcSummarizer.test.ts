import { describe, it, expect } from "vitest";
import { buildArcSummarizerPrompt, parseArcSummarizerResponse } from "./arcSummarizer";

describe("buildArcSummarizerPrompt", () => {
  it("inclui a premissa da campanha no prompt", () => {
    const prompt = buildArcSummarizerPrompt(
      "Um herói busca vingança contra o imperador tirano",
      "=== Cena 1 ===\nO herói parte da aldeia.",
    );
    expect(prompt).toContain("Um herói busca vingança contra o imperador tirano");
  });

  it("inclui o bloco de resumos de cenas no prompt", () => {
    const prompt = buildArcSummarizerPrompt(
      "Premissa da campanha",
      "=== Cena 1 ===\nO herói parte da aldeia.",
    );
    expect(prompt).toContain("=== Cena 1 ===");
    expect(prompt).toContain("O herói parte da aldeia.");
  });

  it("contém instruções de formato com 300-500 palavras e 5 parágrafos", () => {
    const prompt = buildArcSummarizerPrompt("Premissa", "Resumos");
    expect(prompt).toContain("300-500 palavras");
    expect(prompt).toContain("5 parágrafos");
  });

  it("instrui a não incluir títulos de seção no output", () => {
    const prompt = buildArcSummarizerPrompt("Premissa", "Resumos");
    expect(prompt).toContain("sem títulos de seção");
  });

  it("menciona CONTINUIDADE como foco", () => {
    const prompt = buildArcSummarizerPrompt("Premissa", "Resumos");
    expect(prompt).toContain("CONTINUIDADE");
  });
});

describe("parseArcSummarizerResponse", () => {
  it("retorna o texto bruto sem modificação", () => {
    const raw = "Este é o resumo do arco narrativo completo.";
    expect(parseArcSummarizerResponse(raw)).toBe(raw);
  });

  it("retorna string vazia quando recebe string vazia", () => {
    expect(parseArcSummarizerResponse("")).toBe("");
  });

  it("preserva quebras de linha no texto", () => {
    const raw = "Parágrafo um do arco.\n\nParágrafo dois do arco.";
    expect(parseArcSummarizerResponse(raw)).toBe(raw);
  });
});
