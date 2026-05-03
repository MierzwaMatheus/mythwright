import { describe, test, expect } from "vitest";
import { buildCharacterBlock, buildSceneBlock } from "./contextBuilder";

const baseCharacter = {
  _id: "characters:abc123" as any,
  _creationTime: 1234567890,
  campaignId: "campaigns:xyz" as any,
  name: "Aldric Vane",
  aspects: ["Born in the Ashes", "Debt to the Thieves Guild"],
  skills: { Fight: 4, Athletics: 3, Notice: 2 },
  stunts: ["Hard to Kill", "Quick Draw"],
  fatePoints: 3,
  stress: {
    physical: [false, false, true],
    mental: [false, true],
  },
  consequences: [
    { severity: "mild" as const, description: "Bruised Ribs" },
  ],
};

describe("buildCharacterBlock", () => {
  test("retorna string JSON compacta com os campos corretos", () => {
    const result = buildCharacterBlock(baseCharacter);

    const parsed = JSON.parse(result);

    expect(parsed.aspects).toEqual(baseCharacter.aspects);
    expect(parsed.skills).toEqual(baseCharacter.skills);
    expect(parsed.stunts).toEqual(baseCharacter.stunts);
    expect(parsed.fatePoints).toEqual(baseCharacter.fatePoints);
    expect(parsed.stress).toEqual(baseCharacter.stress);
    expect(parsed.consequences).toEqual(baseCharacter.consequences);
  });

  test("não inclui _id, _creationTime, campaignId nem name no output", () => {
    const result = buildCharacterBlock(baseCharacter);
    const parsed = JSON.parse(result);

    expect(parsed).not.toHaveProperty("_id");
    expect(parsed).not.toHaveProperty("_creationTime");
    expect(parsed).not.toHaveProperty("campaignId");
    expect(parsed).not.toHaveProperty("name");
  });

  test("retorna JSON compacto (sem indentação)", () => {
    const result = buildCharacterBlock(baseCharacter);

    expect(result).toBe(JSON.stringify(result.startsWith("{") ? JSON.parse(result) : result));
    expect(result).not.toMatch(/\n/);
    expect(result).not.toMatch(/  /);
  });

  test("é determinístico — mesma entrada produz mesma saída", () => {
    const result1 = buildCharacterBlock(baseCharacter);
    const result2 = buildCharacterBlock(baseCharacter);

    expect(result1).toBe(result2);
  });

  test("funciona com personagem sem consequences", () => {
    const char = { ...baseCharacter, consequences: [] };
    const result = buildCharacterBlock(char);
    const parsed = JSON.parse(result);

    expect(parsed.consequences).toEqual([]);
  });

  test("funciona com skills vazio", () => {
    const char = { ...baseCharacter, skills: {} };
    const result = buildCharacterBlock(char);
    const parsed = JSON.parse(result);

    expect(parsed.skills).toEqual({});
  });
});

describe("buildSceneBlock", () => {
  const baseScene = {
    title: "Taverna do Lobo Cinza",
    description: "Uma taverna mal iluminada no porto",
    status: "active" as const,
  };

  const knownNpc = {
    name: "Mira",
    visibility: "known" as const,
    description: "Uma taverneira de olhos perspicazes",
    type: "npc" as const,
  };

  const hiddenNpc = {
    name: "Espião Secreto",
    visibility: "hidden" as const,
    description: "Ninguém sabe que ele existe",
    type: "npc" as const,
  };

  const knownFact = {
    content: "A taverna serve como ponto de encontro de mercadores",
    visibility: "known" as const,
  };

  const rumoredFact = {
    content: "Dizem que o dono guarda ouro embaixo do balcão",
    visibility: "rumored" as const,
  };

  const hiddenFact = {
    content: "O dono é na verdade um agente da guilda dos assassinos",
    visibility: "hidden" as const,
  };

  test("entidades hidden nunca aparecem em npcsPresent", () => {
    const result = buildSceneBlock(baseScene, [knownNpc, hiddenNpc], []);

    expect(result.npcsPresent).toHaveLength(1);
    expect(result.npcsPresent[0].name).toBe("Mira");
    expect(result.npcsPresent.some((e: { name: string }) => e.name === "Espião Secreto")).toBe(false);
  });

  test("retorna location com o title da cena", () => {
    const result = buildSceneBlock(baseScene, [], []);

    expect(result.location).toBe("Taverna do Lobo Cinza");
  });

  test("npcsPresent contém apenas name e description (sem visibility)", () => {
    const result = buildSceneBlock(baseScene, [knownNpc], []);

    expect(result.npcsPresent[0]).toEqual({
      name: "Mira",
      description: "Uma taverneira de olhos perspicazes",
    });
    expect(result.npcsPresent[0]).not.toHaveProperty("visibility");
  });

  test("aspects inclui fatos known e rumored mas não hidden", () => {
    const result = buildSceneBlock(baseScene, [], [knownFact, rumoredFact, hiddenFact]);

    expect(result.aspects).toHaveLength(2);
    expect(result.aspects).toContain(knownFact.content);
    expect(result.aspects).toContain(rumoredFact.content);
    expect(result.aspects).not.toContain(hiddenFact.content);
  });

  test("activeObjectives é sempre array vazio", () => {
    const result = buildSceneBlock(baseScene, [knownNpc], [knownFact]);

    expect(result.activeObjectives).toEqual([]);
  });

  test("entities vazio retorna npcsPresent vazio", () => {
    const result = buildSceneBlock(baseScene, [], [knownFact]);

    expect(result.npcsPresent).toEqual([]);
  });

  test("facts vazio retorna aspects vazio", () => {
    const result = buildSceneBlock(baseScene, [knownNpc], []);

    expect(result.aspects).toEqual([]);
  });
});
