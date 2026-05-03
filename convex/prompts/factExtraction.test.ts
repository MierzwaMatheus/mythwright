import { describe, it, expect } from "vitest";
import { buildFactExtractionPrompt } from "./factExtraction";

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
