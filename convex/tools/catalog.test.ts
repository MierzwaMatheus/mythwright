/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { FATE_TOOLS, getFateTools, getFateTool } from "./catalog";

describe("FATE tools catalog", () => {
  it("deve exportar array de 11 tools", () => {
    expect(FATE_TOOLS).toHaveLength(11);
  });

  it("cada tool deve ter name, description e function com parameters JSON Schema", () => {
    for (const tool of FATE_TOOLS) {
      expect(tool).toHaveProperty("type", "function");
      expect(tool.function).toHaveProperty("name");
      expect(typeof tool.function.name).toBe("string");
      expect(tool.function).toHaveProperty("description");
      expect(typeof tool.function.description).toBe("string");
      expect(tool.function).toHaveProperty("parameters");
      expect(tool.function.parameters).toHaveProperty("type", "object");
      expect(tool.function.parameters).toHaveProperty("properties");
      expect(tool.function.parameters).toHaveProperty("required");
    }
  });

  it("deve incluir todas as 11 tools FATE obrigatórias", () => {
    const names = FATE_TOOLS.map((t) => t.function.name);
    const expectedTools = [
      "roll_fate_dice",
      "invoke_aspect",
      "compel_aspect",
      "apply_stress",
      "apply_consequence",
      "award_fate_point",
      "spend_fate_point",
      "add_scene_aspect",
      "change_scene",
      "reveal_fact",
      "reveal_entity",
    ];
    for (const name of expectedTools) {
      expect(names).toContain(name);
    }
  });

  it("getFateTools() deve retornar o mesmo array FATE_TOOLS", () => {
    expect(getFateTools()).toBe(FATE_TOOLS);
  });

  it("getFateTool(name) deve retornar a tool pelo nome", () => {
    const tool = getFateTool("roll_fate_dice");
    expect(tool).toBeDefined();
    expect(tool!.function.name).toBe("roll_fate_dice");
  });

  it("getFateTool com nome inexistente deve retornar undefined", () => {
    expect(getFateTool("nonexistent_tool")).toBeUndefined();
  });

  describe("roll_fate_dice", () => {
    it("deve ter parâmetros: skillName, skillLevel, description, seed, type", () => {
      const tool = getFateTool("roll_fate_dice")!;
      const props = tool.function.parameters.properties;
      expect(props).toHaveProperty("skillName");
      expect(props).toHaveProperty("skillLevel");
      expect(props).toHaveProperty("description");
      expect(props).toHaveProperty("seed");
      expect(props).toHaveProperty("type");
      expect(tool.function.parameters.required).toContain("skillName");
      expect(tool.function.parameters.required).toContain("skillLevel");
      expect(tool.function.parameters.required).toContain("description");
      expect(tool.function.parameters.required).toContain("seed");
      expect(tool.function.parameters.required).toContain("type");
    });

    it("type deve ser enum com os 4 tipos FATE válidos", () => {
      const tool = getFateTool("roll_fate_dice")!;
      const typeProp = tool.function.parameters.properties.type;
      expect(typeProp.enum).toEqual(
        expect.arrayContaining(["attack", "defend", "overcome", "create_advantage"])
      );
    });
  });

  describe("invoke_aspect", () => {
    it("deve ter parâmetros: aspectId, effect, rollId", () => {
      const tool = getFateTool("invoke_aspect")!;
      const props = tool.function.parameters.properties;
      expect(props).toHaveProperty("aspectId");
      expect(props).toHaveProperty("effect");
      expect(props).toHaveProperty("rollId");
      expect(tool.function.parameters.required).toContain("aspectId");
      expect(tool.function.parameters.required).toContain("effect");
      expect(tool.function.parameters.required).toContain("rollId");
    });

    it("effect deve ser enum bonus_2 | reroll", () => {
      const tool = getFateTool("invoke_aspect")!;
      const effectProp = tool.function.parameters.properties.effect;
      expect(effectProp.enum).toEqual(expect.arrayContaining(["bonus_2", "reroll"]));
    });
  });

  describe("compel_aspect", () => {
    it("deve ter parâmetros: aspectId, characterId, complication", () => {
      const tool = getFateTool("compel_aspect")!;
      const props = tool.function.parameters.properties;
      expect(props).toHaveProperty("aspectId");
      expect(props).toHaveProperty("characterId");
      expect(props).toHaveProperty("complication");
      expect(tool.function.parameters.required).toContain("aspectId");
      expect(tool.function.parameters.required).toContain("characterId");
      expect(tool.function.parameters.required).toContain("complication");
    });
  });

  describe("apply_stress", () => {
    it("deve ter parâmetros: characterId, amount, track", () => {
      const tool = getFateTool("apply_stress")!;
      const props = tool.function.parameters.properties;
      expect(props).toHaveProperty("characterId");
      expect(props).toHaveProperty("amount");
      expect(props).toHaveProperty("track");
      expect(tool.function.parameters.required).toContain("characterId");
      expect(tool.function.parameters.required).toContain("amount");
      expect(tool.function.parameters.required).toContain("track");
    });

    it("track deve ser enum physical | mental", () => {
      const tool = getFateTool("apply_stress")!;
      const trackProp = tool.function.parameters.properties.track;
      expect(trackProp.enum).toEqual(expect.arrayContaining(["physical", "mental"]));
    });
  });

  describe("apply_consequence", () => {
    it("deve ter parâmetros: characterId, severity, description", () => {
      const tool = getFateTool("apply_consequence")!;
      const props = tool.function.parameters.properties;
      expect(props).toHaveProperty("characterId");
      expect(props).toHaveProperty("severity");
      expect(props).toHaveProperty("description");
      expect(tool.function.parameters.required).toContain("characterId");
      expect(tool.function.parameters.required).toContain("severity");
      expect(tool.function.parameters.required).toContain("description");
    });

    it("severity deve ser enum mild | moderate | severe", () => {
      const tool = getFateTool("apply_consequence")!;
      const severityProp = tool.function.parameters.properties.severity;
      expect(severityProp.enum).toEqual(
        expect.arrayContaining(["mild", "moderate", "severe"])
      );
    });
  });

  describe("award_fate_point", () => {
    it("deve ter parâmetros: characterId, reason", () => {
      const tool = getFateTool("award_fate_point")!;
      const props = tool.function.parameters.properties;
      expect(props).toHaveProperty("characterId");
      expect(props).toHaveProperty("reason");
      expect(tool.function.parameters.required).toContain("characterId");
      expect(tool.function.parameters.required).toContain("reason");
    });
  });

  describe("spend_fate_point", () => {
    it("deve ter parâmetros: characterId, reason", () => {
      const tool = getFateTool("spend_fate_point")!;
      const props = tool.function.parameters.properties;
      expect(props).toHaveProperty("characterId");
      expect(props).toHaveProperty("reason");
      expect(tool.function.parameters.required).toContain("characterId");
      expect(tool.function.parameters.required).toContain("reason");
    });
  });

  describe("add_scene_aspect", () => {
    it("deve ter parâmetros: sceneId, text, freeInvokes", () => {
      const tool = getFateTool("add_scene_aspect")!;
      const props = tool.function.parameters.properties;
      expect(props).toHaveProperty("sceneId");
      expect(props).toHaveProperty("text");
      expect(props).toHaveProperty("freeInvokes");
      expect(tool.function.parameters.required).toContain("sceneId");
      expect(tool.function.parameters.required).toContain("text");
    });
  });

  describe("change_scene", () => {
    it("deve ter parâmetros: campaignId, title, description", () => {
      const tool = getFateTool("change_scene")!;
      const props = tool.function.parameters.properties;
      expect(props).toHaveProperty("campaignId");
      expect(props).toHaveProperty("title");
      expect(tool.function.parameters.required).toContain("campaignId");
      expect(tool.function.parameters.required).toContain("title");
    });
  });

  describe("reveal_fact", () => {
    it("deve ter parâmetros: factId", () => {
      const tool = getFateTool("reveal_fact")!;
      const props = tool.function.parameters.properties;
      expect(props).toHaveProperty("factId");
      expect(tool.function.parameters.required).toContain("factId");
    });
  });

  describe("reveal_entity", () => {
    it("deve ter parâmetros: entityId", () => {
      const tool = getFateTool("reveal_entity")!;
      const props = tool.function.parameters.properties;
      expect(props).toHaveProperty("entityId");
      expect(tool.function.parameters.required).toContain("entityId");
    });
  });
});
