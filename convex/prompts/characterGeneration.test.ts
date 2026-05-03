import { describe, expect, it } from "vitest";
import {
  buildCharacterGenerationPrompt,
  parseCharacterGenerationResponse,
  CharacterGenerationInput,
  CharacterGenerationOutput,
} from "./characterGeneration";

const baseInput: CharacterGenerationInput = {
  characterPremise: "Um detetive desiludido com passado militar.",
  campaignPremise: "Um caçador de recompensas em uma cidade portuária corrupta.",
  campaignTone: "noir",
};

const validCharacter: CharacterGenerationOutput = {
  name: "Marcos Veil",
  high_concept: "Detetive Cético em Cidade Embruxada",
  trouble: "Devo Favores ao Crime Organizado",
  other_aspects: [
    "Veterano da Guerra do Norte",
    "O Caso que Me Quebrou",
    "Aliado Improvável no Porto",
  ],
  skills: {
    Investigar: 4,
    Empatia: 3,
    Notar: 3,
    Comunicar: 2,
    Vontade: 2,
    Atletismo: 2,
    Lutar: 1,
    Contatos: 1,
    Saber: 1,
    Sobreviver: 1,
  },
  stunts: [
    {
      name: "Olho Treinado",
      description: "+2 em Notar para detectar mentiras visuais quando o alvo está nervoso.",
    },
    {
      name: "Contatos Militares",
      description: "Pode usar Contatos em vez de Recursos para obter equipamento militar.",
    },
    {
      name: "Interrogatório Duro",
      description: "+2 em Provocar para criar vantagens durante interrogatórios.",
    },
  ],
  fate_points: 3,
  stress: {
    physical: [false, false, false],
    mental: [false, false, false],
  },
  background_summary:
    "Marcos serviu no exército por dez anos antes de tornar-se detetive particular.",
};

describe("buildCharacterGenerationPrompt", () => {
  it("should include character premise", () => {
    const prompt = buildCharacterGenerationPrompt(baseInput);
    expect(prompt).toContain("Um detetive desiludido com passado militar.");
  });

  it("should include campaign premise", () => {
    const prompt = buildCharacterGenerationPrompt(baseInput);
    expect(prompt).toContain("Um caçador de recompensas em uma cidade portuária corrupta.");
  });

  it("should include campaign tone", () => {
    const prompt = buildCharacterGenerationPrompt(baseInput);
    expect(prompt).toContain("noir");
  });

  it("should include JSON format specification", () => {
    const prompt = buildCharacterGenerationPrompt(baseInput);
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("high_concept");
    expect(prompt).toContain("trouble");
    expect(prompt).toContain("skills");
    expect(prompt).toContain("stunts");
  });

  it("should include skill pyramid specification", () => {
    const prompt = buildCharacterGenerationPrompt(baseInput);
    expect(prompt).toContain("pirâmide");
    expect(prompt).toContain("+4");
    expect(prompt).toContain("+3");
  });

  it("should include all required skill names", () => {
    const prompt = buildCharacterGenerationPrompt(baseInput);
    expect(prompt).toContain("Investigar");
    expect(prompt).toContain("Atletismo");
    expect(prompt).toContain("Vontade");
  });
});

describe("parseCharacterGenerationResponse", () => {
  it("should parse valid JSON response", () => {
    const raw = JSON.stringify(validCharacter);
    const result = parseCharacterGenerationResponse(raw);

    expect(result).not.toBeNull();
    expect(result!.name).toBe("Marcos Veil");
    expect(result!.high_concept).toBe("Detetive Cético em Cidade Embruxada");
    expect(result!.trouble).toBe("Devo Favores ao Crime Organizado");
    expect(result!.other_aspects).toHaveLength(3);
    expect(result!.stunts).toHaveLength(3);
    expect(result!.fate_points).toBe(3);
  });

  it("should return null for invalid JSON", () => {
    const result = parseCharacterGenerationResponse("not valid json");
    expect(result).toBeNull();
  });

  it("should return null for JSON missing required fields", () => {
    const incomplete = JSON.stringify({ name: "Someone" });
    const result = parseCharacterGenerationResponse(incomplete);
    expect(result).toBeNull();
  });

  it("should handle JSON wrapped in markdown code block", () => {
    const raw = "```json\n" + JSON.stringify(validCharacter) + "\n```";
    const result = parseCharacterGenerationResponse(raw);

    expect(result).not.toBeNull();
    expect(result!.name).toBe("Marcos Veil");
  });

  it("should validate skill pyramid: exactly 10 skills total", () => {
    const raw = JSON.stringify(validCharacter);
    const result = parseCharacterGenerationResponse(raw);

    expect(result).not.toBeNull();
    const skillCount = Object.keys(result!.skills).length;
    expect(skillCount).toBe(10);
  });

  it("should validate that exactly 5 aspects are present (high_concept + trouble + 3 others)", () => {
    const raw = JSON.stringify(validCharacter);
    const result = parseCharacterGenerationResponse(raw);

    expect(result).not.toBeNull();
    expect(result!.other_aspects).toHaveLength(3);
    // Total aspects = high_concept(1) + trouble(1) + other_aspects(3) = 5
  });

  it("should validate that stunts have name and description", () => {
    const raw = JSON.stringify(validCharacter);
    const result = parseCharacterGenerationResponse(raw);

    expect(result).not.toBeNull();
    for (const stunt of result!.stunts) {
      expect(stunt.name).toBeDefined();
      expect(stunt.description).toBeDefined();
      expect(typeof stunt.name).toBe("string");
      expect(typeof stunt.description).toBe("string");
    }
  });

  it("should validate stress tracks structure", () => {
    const raw = JSON.stringify(validCharacter);
    const result = parseCharacterGenerationResponse(raw);

    expect(result).not.toBeNull();
    expect(Array.isArray(result!.stress.physical)).toBe(true);
    expect(Array.isArray(result!.stress.mental)).toBe(true);
    expect(result!.stress.physical.every((v) => typeof v === "boolean")).toBe(true);
    expect(result!.stress.mental.every((v) => typeof v === "boolean")).toBe(true);
  });

  it("should return null when skills total is not 10", () => {
    const invalidChar = {
      ...validCharacter,
      skills: { Investigar: 4, Empatia: 3 }, // only 2 skills
    };
    const result = parseCharacterGenerationResponse(JSON.stringify(invalidChar));
    expect(result).toBeNull();
  });

  it("should return null when other_aspects does not have 3 items", () => {
    const invalidChar = {
      ...validCharacter,
      other_aspects: ["Apenas Um Aspecto"], // should have 3
    };
    const result = parseCharacterGenerationResponse(JSON.stringify(invalidChar));
    expect(result).toBeNull();
  });
});
