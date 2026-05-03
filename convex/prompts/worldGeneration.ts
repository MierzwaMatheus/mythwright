export interface WorldGenerationInput {
  campaignName: string;
  premise: string;
  tone: string;
  expectedDuration: "one-shot" | "medium" | "long";
  freeDescription: string;
}

export interface WorldNpc {
  name: string;
  type: "npc";
  visibility: "known" | "rumored" | "hidden";
  description: string;
  hidden_motivation: string;
  tier: "nameless" | "supporting" | "main";
}

export interface WorldFaction {
  name: string;
  type: "faction";
  visibility: "known" | "rumored";
  description: string;
  agenda: string;
}

export interface WorldFact {
  content: string;
  visibility: "known" | "rumored" | "hidden";
  category: "background" | "secret" | "world_rule" | "event";
  related_entity_names: string[];
}

export interface WorldTriggerEffect {
  type: "reveal_fact" | "reveal_entity" | "change_visibility";
  target_description: string;
}

export interface WorldTrigger {
  description: string;
  scope: "global" | "scene" | "location";
  scope_target_name: string | null;
  effects: WorldTriggerEffect[];
  one_shot: boolean;
}

export interface WorldStartingScene {
  title: string;
  description: string;
  aspects: string[];
  present_npc_names: string[];
}

export interface WorldStartingLocation {
  name: string;
  type: "location";
  description: string;
  aspects: string[];
}

export interface WorldGenerationOutput {
  world_overview: string;
  starting_location: WorldStartingLocation;
  npcs: WorldNpc[];
  factions: WorldFaction[];
  facts: WorldFact[];
  triggers: WorldTrigger[];
  starting_scene: WorldStartingScene;
}

const DURATION_SCALE: Record<
  "one-shot" | "medium" | "long",
  { npcs: number; facts: string; triggers: number; factions: string }
> = {
  "one-shot": {
    npcs: 3,
    facts: "8 fatos (5 known/rumored + 3 hidden)",
    triggers: 3,
    factions: "0 facções",
  },
  medium: {
    npcs: 5,
    facts: "12 fatos (7 known/rumored + 5 hidden)",
    triggers: 6,
    factions: "2 facções",
  },
  long: {
    npcs: 7,
    facts: "18 fatos (10 known/rumored + 8 hidden)",
    triggers: 10,
    factions: "3 facções",
  },
};

export function buildWorldGenerationPrompt(input: WorldGenerationInput): string {
  const scale = DURATION_SCALE[input.expectedDuration];

  return `Você é um designer de mundos para RPG narrativo. Sua tarefa é gerar o mundo inicial de uma campanha solo de FATE Condensed a partir da premissa do jogador.

CAMPANHA: ${input.campaignName}

PREMISSA: ${input.premise}

TOM: ${input.tone}

DURAÇÃO ESPERADA: ${input.expectedDuration}
- one-shot: 1-3 sessões. Conflito central simples, resolução clara.
- medium: 5-15 sessões. 2-3 arcos, mundo médio.
- long: 20+ sessões. Mundo amplo, múltiplas facções, segredos profundos.

DESCRIÇÃO ADICIONAL DO JOGADOR:
${input.freeDescription || "(nenhuma)"}

INSTRUÇÕES:

Gere um mundo coeso, vivido, com possibilidade narrativa imediata. Princípios:

1. **NPCs interessantes têm contradições.** Um nobre piedoso que sonega impostos. Um guarda corrupto que ama os filhos.
2. **Fatos hidden são sementes de revelação.** Cada fato hidden deve ter um gatilho associado que o revela.
3. **Gatilhos são naturais.** A condição deve ser algo que o jogador realmente faria, não uma sequência rígida.
4. **A cena inicial é uma porta entreaberta.** Apresenta o tom e oferece direções, sem forçar caminho único.

Para duração \`one-shot\`: 3 NPCs, 8 fatos (5 known/rumored + 3 hidden), 3 gatilhos.
Para duração \`medium\`: 5 NPCs, 12 fatos (7 known/rumored + 5 hidden), 6 gatilhos, 2 facções.
Para duração \`long\`: 7 NPCs, 18 fatos (10 known/rumored + 8 hidden), 10 gatilhos, 3 facções.

Para esta campanha (${input.expectedDuration}): ${scale.npcs} NPCs, ${scale.facts}, ${scale.triggers} gatilhos, ${scale.factions}.

Responda APENAS com JSON no formato:

{
  "world_overview": "2-3 parágrafos descrevendo o mundo, atmosfera, pano de fundo",

  "starting_location": {
    "name": "Nome do local",
    "type": "location",
    "description": "Descrição visual e atmosférica",
    "aspects": ["Aspecto 1", "Aspecto 2"]
  },

  "npcs": [
    {
      "name": "Nome",
      "type": "npc",
      "visibility": "known",
      "description": "Descrição pública (o que é visível ao jogador)",
      "hidden_motivation": "Motivação oculta (apenas para uso interno do GM)",
      "tier": "supporting"
    }
  ],

  "factions": [
    {
      "name": "Nome",
      "type": "faction",
      "visibility": "known",
      "description": "O que se sabe publicamente",
      "agenda": "O que querem (uso interno)"
    }
  ],

  "facts": [
    {
      "content": "Texto do fato",
      "visibility": "hidden",
      "category": "secret",
      "related_entity_names": ["nome da entidade relacionada"]
    }
  ],

  "triggers": [
    {
      "description": "Descrição em linguagem natural do que ativa o gatilho",
      "scope": "global",
      "scope_target_name": null,
      "effects": [
        {
          "type": "reveal_fact",
          "target_description": "qual fato/entidade afetar (referência por descrição)"
        }
      ],
      "one_shot": true
    }
  ],

  "starting_scene": {
    "title": "Título evocativo",
    "description": "Descrição da cena, ~150 palavras, em segunda pessoa ('você está...')",
    "aspects": ["Aspecto 1", "Aspecto 2"],
    "present_npc_names": ["NPC 1", "NPC 2"]
  }
}

Importante:
- Use referências por nome em \`related_entity_names\`, \`scope_target_name\`, \`present_npc_names\`. O sistema fará a resolução para IDs internos.
- Visibilidade inicial: a maioria dos NPCs presentes na cena inicial deve ser \`known\`. Os interessantes mas distantes podem ser \`rumored\`. Apenas NPCs verdadeiramente secretos são \`hidden\`.
- Cada fato hidden DEVE ter um gatilho que o revela.
- Gatilhos one_shot: gatilhos de revelação geralmente são one_shot=true. Gatilhos de eventos repetíveis são one_shot=false.`;
}

function isValidNpc(obj: unknown): obj is WorldNpc {
  if (!obj || typeof obj !== "object") return false;
  const n = obj as Record<string, unknown>;
  return (
    typeof n.name === "string" &&
    n.type === "npc" &&
    ["known", "rumored", "hidden"].includes(n.visibility as string) &&
    typeof n.description === "string" &&
    ["nameless", "supporting", "main"].includes(n.tier as string)
  );
}

function isValidFaction(obj: unknown): obj is WorldFaction {
  if (!obj || typeof obj !== "object") return false;
  const f = obj as Record<string, unknown>;
  return (
    typeof f.name === "string" &&
    f.type === "faction" &&
    ["known", "rumored"].includes(f.visibility as string) &&
    typeof f.description === "string"
  );
}

function isValidFact(obj: unknown): obj is WorldFact {
  if (!obj || typeof obj !== "object") return false;
  const f = obj as Record<string, unknown>;
  return (
    typeof f.content === "string" &&
    ["known", "rumored", "hidden"].includes(f.visibility as string) &&
    ["background", "secret", "world_rule", "event"].includes(f.category as string)
  );
}

function isValidTrigger(obj: unknown): obj is WorldTrigger {
  if (!obj || typeof obj !== "object") return false;
  const t = obj as Record<string, unknown>;
  return (
    typeof t.description === "string" &&
    ["global", "scene", "location"].includes(t.scope as string) &&
    Array.isArray(t.effects) &&
    typeof t.one_shot === "boolean"
  );
}

function isValidStartingScene(obj: unknown): obj is WorldStartingScene {
  if (!obj || typeof obj !== "object") return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s.title === "string" &&
    typeof s.description === "string" &&
    Array.isArray(s.aspects) &&
    Array.isArray(s.present_npc_names)
  );
}

function isValidStartingLocation(obj: unknown): obj is WorldStartingLocation {
  if (!obj || typeof obj !== "object") return false;
  const l = obj as Record<string, unknown>;
  return (
    typeof l.name === "string" &&
    l.type === "location" &&
    typeof l.description === "string" &&
    Array.isArray(l.aspects)
  );
}

export function parseWorldGenerationResponse(raw: string): WorldGenerationOutput | null {
  try {
    // Strip markdown code block if present
    let cleaned = raw.trim();
    const codeBlockMatch = cleaned.match(/^```(?:json)?\n?([\s\S]*?)\n?```$/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
    }

    const parsed = JSON.parse(cleaned);

    if (typeof parsed.world_overview !== "string") return null;
    if (!isValidStartingLocation(parsed.starting_location)) return null;
    if (!Array.isArray(parsed.npcs) || !parsed.npcs.every(isValidNpc)) return null;
    if (!Array.isArray(parsed.factions) || !parsed.factions.every(isValidFaction)) return null;
    if (!Array.isArray(parsed.facts) || !parsed.facts.every(isValidFact)) return null;
    if (!Array.isArray(parsed.triggers) || !parsed.triggers.every(isValidTrigger)) return null;
    if (!isValidStartingScene(parsed.starting_scene)) return null;

    return parsed as WorldGenerationOutput;
  } catch {
    return null;
  }
}
