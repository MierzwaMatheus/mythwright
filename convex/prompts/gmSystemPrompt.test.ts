import { describe, it, expect } from "vitest";
import { buildGmSystemPrompt } from "./gmSystemPrompt";

describe("buildGmSystemPrompt", () => {
  it("injeta tone no lugar de {{campaign_tone}}", () => {
    const prompt = buildGmSystemPrompt({
      tone: "Sombrio e investigativo",
      premise: "Uma cidade portuária corrompida",
    });
    expect(prompt).toContain("Sombrio e investigativo");
  });

  it("injeta premise no lugar de {{campaign_premise}}", () => {
    const prompt = buildGmSystemPrompt({
      tone: "Sombrio e investigativo",
      premise: "Uma cidade portuária corrompida",
    });
    expect(prompt).toContain("Uma cidade portuária corrompida");
  });

  it("contém a string FATE Condensed", () => {
    const prompt = buildGmSystemPrompt({
      tone: "Épico e grandioso",
      premise: "Guerra entre deuses",
    });
    expect(prompt).toContain("FATE Condensed");
  });

  it("contém as regras de rolagem com 4dF ou 4 dados FATE", () => {
    const prompt = buildGmSystemPrompt({
      tone: "Épico e grandioso",
      premise: "Guerra entre deuses",
    });
    const hasDiceRule =
      prompt.includes("4dF") || prompt.includes("4 dados FATE");
    expect(hasDiceRule).toBe(true);
  });

  it("contém instrução sobre a tool roll_fate_dice", () => {
    const prompt = buildGmSystemPrompt({
      tone: "Misterioso",
      premise: "Ruínas antigas no deserto",
    });
    expect(prompt).toContain("roll_fate_dice");
  });

  it("valores diferentes de tone/premise produzem prompts diferentes", () => {
    const prompt1 = buildGmSystemPrompt({
      tone: "Cômico e absurdo",
      premise: "Heróis trabalhando numa padaria mágica",
    });
    const prompt2 = buildGmSystemPrompt({
      tone: "Sombrio e pesado",
      premise: "Sobreviventes num mundo pós-apocalíptico",
    });
    expect(prompt1).not.toBe(prompt2);
  });

  it("não contém o placeholder {{campaign_tone}} após substituição", () => {
    const prompt = buildGmSystemPrompt({
      tone: "Qualquer tom",
      premise: "Qualquer premissa",
    });
    expect(prompt).not.toContain("{{campaign_tone}}");
  });

  it("não contém o placeholder {{campaign_premise}} após substituição", () => {
    const prompt = buildGmSystemPrompt({
      tone: "Qualquer tom",
      premise: "Qualquer premissa",
    });
    expect(prompt).not.toContain("{{campaign_premise}}");
  });
});
