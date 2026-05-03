import { describe, it, expect } from "vitest";
import { buildFactExtractionPrompt, parseFactExtractionResponse } from "./factExtraction";

describe("buildFactExtractionPrompt", () => {
  const gmResponse = "O cavaleiro encontrou uma caverna escondida ao norte da floresta.";

  const existingFacts = [
    { content: "Existe uma passagem secreta no castelo." },
    { content: "O rei possui um irmão gêmeo desconhecido." },
  ];

  it("inclui os fatos existentes no prompt para o LLM não recriar", () => {
    const prompt = buildFactExtractionPrompt(gmResponse, existingFacts);

    expect(prompt).toContain("Existe uma passagem secreta no castelo.");
    expect(prompt).toContain("O rei possui um irmão gêmeo desconhecido.");
  });

  it("inclui a resposta do GM no prompt para análise", () => {
    const prompt = buildFactExtractionPrompt(gmResponse, existingFacts);

    expect(prompt).toContain(gmResponse);
  });

  it("especifica o formato JSON de saída no prompt", () => {
    const prompt = buildFactExtractionPrompt(gmResponse, existingFacts);

    expect(prompt).toContain("facts");
    expect(prompt).toContain("content");
    expect(prompt).toContain("visibility");
    expect(prompt).toContain("relatedEntityIds");
  });

  it("funciona corretamente com lista vazia de fatos existentes", () => {
    const prompt = buildFactExtractionPrompt(gmResponse, []);

    expect(prompt).toContain(gmResponse);
    expect(prompt).toContain("facts");
  });

  it("lista múltiplos fatos existentes no prompt", () => {
    const manyFacts = [
      { content: "Fato A sobre o mundo." },
      { content: "Fato B sobre o mundo." },
      { content: "Fato C sobre o mundo." },
    ];

    const prompt = buildFactExtractionPrompt(gmResponse, manyFacts);

    expect(prompt).toContain("Fato A sobre o mundo.");
    expect(prompt).toContain("Fato B sobre o mundo.");
    expect(prompt).toContain("Fato C sobre o mundo.");
  });
});

describe("parseFactExtractionResponse", () => {
  it("retorna apenas fatos válidos quando há mix de válidos e inválidos", () => {
    const raw = JSON.stringify({
      facts: [
        { content: "A floresta é encantada.", visibility: "known", relatedEntityIds: ["loc-1"] },
        { content: "", visibility: "known", relatedEntityIds: [] },
        { content: "O rei tem um segredo.", visibility: "public", relatedEntityIds: [] },
        { content: "A bruxa mora no norte.", visibility: "hidden", relatedEntityIds: ["char-2"] },
      ],
    });

    const result = parseFactExtractionResponse(raw);

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("A floresta é encantada.");
    expect(result[1].content).toBe("A bruxa mora no norte.");
  });

  it("retorna todos os fatos quando todos são válidos", () => {
    const raw = JSON.stringify({
      facts: [
        { content: "Fato um.", visibility: "hidden", relatedEntityIds: [] },
        { content: "Fato dois.", visibility: "rumored", relatedEntityIds: ["x"] },
        { content: "Fato três.", visibility: "known", relatedEntityIds: ["a", "b"] },
      ],
    });

    const result = parseFactExtractionResponse(raw);

    expect(result).toHaveLength(3);
  });

  it("retorna array vazio sem lançar exceção quando JSON é malformado", () => {
    expect(() => parseFactExtractionResponse("não é json")).not.toThrow();
    expect(parseFactExtractionResponse("não é json")).toEqual([]);
  });

  it("retorna array vazio quando JSON não possui o campo facts", () => {
    const raw = JSON.stringify({ items: [] });

    expect(parseFactExtractionResponse(raw)).toEqual([]);
  });

  it("descarta fato com content vazio", () => {
    const raw = JSON.stringify({
      facts: [{ content: "", visibility: "known", relatedEntityIds: [] }],
    });

    expect(parseFactExtractionResponse(raw)).toEqual([]);
  });

  it("descarta fato com visibility inválida", () => {
    const raw = JSON.stringify({
      facts: [{ content: "Fato válido.", visibility: "public", relatedEntityIds: [] }],
    });

    expect(parseFactExtractionResponse(raw)).toEqual([]);
  });

  it("descarta fato com relatedEntityIds ausente ou não-array", () => {
    const rawAusente = JSON.stringify({
      facts: [{ content: "Fato sem ids.", visibility: "known" }],
    });
    const rawNaoArray = JSON.stringify({
      facts: [{ content: "Fato ids errados.", visibility: "known", relatedEntityIds: "abc" }],
    });

    expect(parseFactExtractionResponse(rawAusente)).toEqual([]);
    expect(parseFactExtractionResponse(rawNaoArray)).toEqual([]);
  });

  it("retorna array vazio quando facts é array vazio", () => {
    const raw = JSON.stringify({ facts: [] });

    expect(parseFactExtractionResponse(raw)).toEqual([]);
  });
});
