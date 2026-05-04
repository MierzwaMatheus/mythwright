export interface CharacterGenerationInput {
  characterPremise: string;
  campaignPremise: string;
  campaignTone: string;
}

export interface CharacterStunt {
  name: string;
  description: string;
}

export interface CharacterGenerationOutput {
  name: string;
  high_concept: string;
  trouble: string;
  other_aspects: string[];
  skills: Record<string, number>;
  stunts: CharacterStunt[];
  fate_points: number;
  stress: {
    physical: boolean[];
    mental: boolean[];
  };
  background_summary: string;
}

export function buildCharacterGenerationPrompt(input: CharacterGenerationInput): string {
  return `Você é um designer de personagens FATE Condensed. Sua tarefa é gerar uma ficha completa a partir da premissa do jogador.

CONTEXTO DA CAMPANHA:
Premissa: ${input.campaignPremise}
Tom: ${input.campaignTone}

PERSONAGEM A GERAR:
${input.characterPremise}

INSTRUÇÕES:

Gere ficha FATE Condensed completa. Princípios:

1. **High Concept** define quem o personagem é em uma frase. Verbo + sujeito.
   Ex: "Detetive Cético em Cidade Embruxada", "Aprendiz Roubado do Poder Ancestral"

2. **Trouble** é o problema que define a vida dele. Algo que vai aparecer.
   Ex: "Devo Favores ao Crime Organizado", "O Que Acordei Não Pode Ser Lacrado de Novo"

3. **Outros 3 Aspectos** vêm de fases narrativas (aventura, cruzando caminhos x2). Devem evocar histórias.

4. **Perícias** seguem pirâmide FATE: 1 em +4, 2 em +3, 3 em +2, 4 em +1. Total: 10 perícias.
   Use: Atletismo, Briga, Comunicar, Conduzir, Contatos, Disfarce, Empatia, Enganar, Furtar, Investigar, Lutar, Notar, Ofícios, Pilotar, Provocar, Recursos, Roubar, Saber, Sobreviver, Vontade.

5. **Façanhas** (3): habilidades especiais que dão +2 em situação específica, ou permitem usar perícia em contexto novo.
   Ex: "Olho Treinado: +2 em Notar para detectar mentiras visuais quando o alvo está nervoso."

6. **Pontos de Destino**: refresh começa em 3 (3 façanhas custam 0 — se houver mais, custa Refresh).

Responda APENAS com JSON:

{
  "name": "Nome",
  "high_concept": "Frase do high concept",
  "trouble": "Frase do trouble",
  "other_aspects": ["Aspecto 1", "Aspecto 2", "Aspecto 3"],
  "skills": {
    "Investigar": 4,
    "Empatia": 3,
    "Notar": 3,
    "Comunicar": 2,
    "Vontade": 2,
    "Atletismo": 2,
    "Lutar": 1,
    "Contatos": 1,
    "Saber": 1,
    "Sobreviver": 1
  },
  "stunts": [
    {
      "name": "Nome da Façanha",
      "description": "Descrição mecânica clara"
    }
  ],
  "fate_points": 3,
  "stress": {
    "physical": [false, false, false],
    "mental": [false, false, false]
  },
  "background_summary": "1-2 parágrafos de história pessoal coerentes com Aspectos"
}

A ficha deve ser jogável em FATE imediatamente. Verifique:
- Pirâmide de perícias correta (1+2+3+4=10)
- Façanhas têm efeito mecânico claro, não apenas sabor
- Trouble é um problema real, não vantagem disfarçada`;
}

function isValidStunt(obj: unknown): obj is CharacterStunt {
  if (!obj || typeof obj !== "object") return false;
  const s = obj as Record<string, unknown>;
  return typeof s.name === "string" && typeof s.description === "string";
}

export function parseCharacterGenerationResponse(
  raw: string,
): CharacterGenerationOutput | null {
  try {
    // Strip markdown code block if present
    let cleaned = raw.trim();
    const codeBlockMatch = cleaned.match(/^```(?:json)?\n?([\s\S]*?)\n?```$/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
    }

    const parsed = JSON.parse(cleaned);

    // Validate required string fields
    if (typeof parsed.name !== "string") return null;
    if (typeof parsed.high_concept !== "string") return null;
    if (typeof parsed.trouble !== "string") return null;
    if (typeof parsed.background_summary !== "string") return null;

    // Validate other_aspects: must be exactly 3
    if (!Array.isArray(parsed.other_aspects) || parsed.other_aspects.length !== 3) return null;

    // Validate skills: must be exactly 10
    if (!parsed.skills || typeof parsed.skills !== "object" || Array.isArray(parsed.skills))
      return null;
    if (Object.keys(parsed.skills).length !== 10) return null;

    // Validate stunts: array of objects with name and description
    if (!Array.isArray(parsed.stunts) || !parsed.stunts.every(isValidStunt)) return null;

    // Validate fate_points
    if (typeof parsed.fate_points !== "number") return null;

    // Validate stress tracks
    if (!parsed.stress || typeof parsed.stress !== "object") return null;
    if (
      !Array.isArray(parsed.stress.physical) ||
      !parsed.stress.physical.every((v: unknown) => typeof v === "boolean")
    )
      return null;
    if (
      !Array.isArray(parsed.stress.mental) ||
      !parsed.stress.mental.every((v: unknown) => typeof v === "boolean")
    )
      return null;

    if (parsed.stress.physical.length < 3) return null;
    if (parsed.stress.mental.length < 3) return null;

    return parsed as CharacterGenerationOutput;
  } catch {
    return null;
  }
}
