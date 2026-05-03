import { describe, expect, it } from "vitest";
import {
  buildWorldGenerationPrompt,
  parseWorldGenerationResponse,
  WorldGenerationInput,
  WorldGenerationOutput,
} from "./worldGeneration";

const baseInput: WorldGenerationInput = {
  campaignName: "A Lâmina de Ferro",
  premise: "Um caçador de recompensas em uma cidade portuária corrupta.",
  tone: "noir",
  expectedDuration: "one-shot",
  freeDescription: "",
};

describe("buildWorldGenerationPrompt", () => {
  it("should include all campaign variables", () => {
    const prompt = buildWorldGenerationPrompt(baseInput);

    expect(prompt).toContain("A Lâmina de Ferro");
    expect(prompt).toContain("Um caçador de recompensas em uma cidade portuária corrupta.");
    expect(prompt).toContain("noir");
    expect(prompt).toContain("one-shot");
  });

  it("should include free_description when provided", () => {
    const input = { ...baseInput, freeDescription: "O personagem perdeu a família." };
    const prompt = buildWorldGenerationPrompt(input);

    expect(prompt).toContain("O personagem perdeu a família.");
  });

  it("should include JSON format instruction", () => {
    const prompt = buildWorldGenerationPrompt(baseInput);
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("world_overview");
    expect(prompt).toContain("starting_scene");
    expect(prompt).toContain("npcs");
    expect(prompt).toContain("facts");
    expect(prompt).toContain("triggers");
  });

  it("should adapt world scale to one-shot duration", () => {
    const prompt = buildWorldGenerationPrompt(baseInput);
    expect(prompt).toContain("one-shot");
    expect(prompt).toMatch(/3 NPCs|8 fatos|3 gatilhos/);
  });

  it("should adapt world scale to medium duration", () => {
    const input = { ...baseInput, expectedDuration: "medium" as const };
    const prompt = buildWorldGenerationPrompt(input);
    expect(prompt).toMatch(/5 NPCs|12 fatos|6 gatilhos/);
  });

  it("should adapt world scale to long duration", () => {
    const input = { ...baseInput, expectedDuration: "long" as const };
    const prompt = buildWorldGenerationPrompt(input);
    expect(prompt).toMatch(/7 NPCs|18 fatos|10 gatilhos/);
  });
});

describe("parseWorldGenerationResponse", () => {
  const validResponse: WorldGenerationOutput = {
    world_overview: "Um porto sombrio controlado por facções criminosas.",
    starting_location: {
      name: "Porto de Ironhaven",
      type: "location",
      description: "Docas enferrujadas e tavernas mal-iluminadas.",
      aspects: ["Névoa Perpétua", "Corrupção à Vista"],
    },
    npcs: [
      {
        name: "Capitão Vosk",
        type: "npc",
        visibility: "known",
        description: "Guarda portuário que aceita suborno.",
        hidden_motivation: "Está planejando um golpe.",
        tier: "supporting",
      },
    ],
    factions: [],
    facts: [
      {
        content: "O Capitão Vosk desviou fundos municipais.",
        visibility: "hidden",
        category: "secret",
        related_entity_names: ["Capitão Vosk"],
      },
    ],
    triggers: [
      {
        description: "Se o jogador investiga as finanças portuárias.",
        scope: "global",
        scope_target_name: null,
        effects: [
          {
            type: "reveal_fact",
            target_description: "O Capitão Vosk desviou fundos municipais.",
          },
        ],
        one_shot: true,
      },
    ],
    starting_scene: {
      title: "Docas ao Amanhecer",
      description: "Você está nas docas. O cheiro de peixe e fumaça paira no ar frio.",
      aspects: ["Névoa Matinal", "Suspense"],
      present_npc_names: ["Capitão Vosk"],
    },
  };

  it("should parse valid JSON response", () => {
    const raw = JSON.stringify(validResponse);
    const result = parseWorldGenerationResponse(raw);

    expect(result).not.toBeNull();
    expect(result!.world_overview).toBe("Um porto sombrio controlado por facções criminosas.");
    expect(result!.npcs).toHaveLength(1);
    expect(result!.npcs[0].name).toBe("Capitão Vosk");
    expect(result!.facts).toHaveLength(1);
    expect(result!.triggers).toHaveLength(1);
    expect(result!.starting_scene.title).toBe("Docas ao Amanhecer");
  });

  it("should return null for invalid JSON", () => {
    const result = parseWorldGenerationResponse("not json at all");
    expect(result).toBeNull();
  });

  it("should return null for JSON missing required fields", () => {
    const incomplete = JSON.stringify({ world_overview: "text only" });
    const result = parseWorldGenerationResponse(incomplete);
    expect(result).toBeNull();
  });

  it("should handle JSON wrapped in markdown code block", () => {
    const raw = "```json\n" + JSON.stringify(validResponse) + "\n```";
    const result = parseWorldGenerationResponse(raw);

    expect(result).not.toBeNull();
    expect(result!.world_overview).toBe("Um porto sombrio controlado por facções criminosas.");
  });

  it("should validate NPC structure", () => {
    const raw = JSON.stringify(validResponse);
    const result = parseWorldGenerationResponse(raw);

    expect(result!.npcs[0]).toMatchObject({
      name: expect.any(String),
      type: "npc",
      visibility: expect.stringMatching(/^(known|rumored|hidden)$/),
      description: expect.any(String),
      tier: expect.stringMatching(/^(nameless|supporting|main)$/),
    });
  });

  it("should validate fact structure", () => {
    const raw = JSON.stringify(validResponse);
    const result = parseWorldGenerationResponse(raw);

    expect(result!.facts[0]).toMatchObject({
      content: expect.any(String),
      visibility: expect.stringMatching(/^(known|rumored|hidden)$/),
      category: expect.stringMatching(/^(background|secret|world_rule|event)$/),
    });
  });

  it("should validate trigger structure", () => {
    const raw = JSON.stringify(validResponse);
    const result = parseWorldGenerationResponse(raw);

    expect(result!.triggers[0]).toMatchObject({
      description: expect.any(String),
      scope: expect.stringMatching(/^(global|scene|location)$/),
      effects: expect.arrayContaining([
        expect.objectContaining({ type: expect.any(String) }),
      ]),
      one_shot: expect.any(Boolean),
    });
  });

  it("should validate starting_scene structure", () => {
    const raw = JSON.stringify(validResponse);
    const result = parseWorldGenerationResponse(raw);

    expect(result!.starting_scene).toMatchObject({
      title: expect.any(String),
      description: expect.any(String),
      aspects: expect.any(Array),
      present_npc_names: expect.any(Array),
    });
  });
});
