import { describe, it, expect } from "vitest";
import { buildAntiLeakPrompt, parseAntiLeakResponse } from "./antiLeak";

describe("buildAntiLeakPrompt", () => {
  const gmResponse = "O cavaleiro derrotou o dragão e encontrou o tesouro perdido.";

  const hiddenFacts = [
    { id: "fact_001", content: "O rei está morto, mas ninguém sabe ainda." },
    { id: "fact_002", content: "A princesa é a assassina do rei." },
  ];

  it("inclui todos os IDs e conteúdos dos fatos hidden no prompt", () => {
    const prompt = buildAntiLeakPrompt(gmResponse, hiddenFacts);

    expect(prompt).toContain("fact_001");
    expect(prompt).toContain("O rei está morto, mas ninguém sabe ainda.");
    expect(prompt).toContain("fact_002");
    expect(prompt).toContain("A princesa é a assassina do rei.");
  });

  it("inclui o formato de resposta esperado no prompt", () => {
    const prompt = buildAntiLeakPrompt(gmResponse, hiddenFacts);

    expect(prompt).toContain("vazou");
    expect(prompt).toContain("facts");
    expect(prompt).toContain("trechos");
  });

  it("inclui a resposta do GM no prompt para análise", () => {
    const prompt = buildAntiLeakPrompt(gmResponse, hiddenFacts);

    expect(prompt).toContain(gmResponse);
  });
});

describe("parseAntiLeakResponse", () => {
  it("retorna os dados corretamente quando JSON válido com vazou: true", () => {
    const raw = JSON.stringify({
      vazou: true,
      facts: ["fact_001"],
      trechos: ["O rei está morto"],
    });

    const result = parseAntiLeakResponse(raw);

    expect(result).toEqual({
      vazou: true,
      facts: ["fact_001"],
      trechos: ["O rei está morto"],
    });
  });

  it("retorna os dados corretamente quando JSON válido com vazou: false", () => {
    const raw = JSON.stringify({
      vazou: false,
      facts: [],
      trechos: [],
    });

    const result = parseAntiLeakResponse(raw);

    expect(result).toEqual({
      vazou: false,
      facts: [],
      trechos: [],
    });
  });

  it("retorna parseError quando JSON malformado", () => {
    const raw = "{ isso não é json válido }";

    const result = parseAntiLeakResponse(raw);

    expect(result).toEqual({
      vazou: false,
      facts: [],
      trechos: [],
      parseError: true,
    });
  });

  it("retorna parseError quando string vazia", () => {
    const raw = "";

    const result = parseAntiLeakResponse(raw);

    expect(result).toEqual({
      vazou: false,
      facts: [],
      trechos: [],
      parseError: true,
    });
  });
});
