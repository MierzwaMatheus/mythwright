import { describe, test, expect } from "vitest";
import { buildCharacterBlock } from "./contextBuilder";

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
