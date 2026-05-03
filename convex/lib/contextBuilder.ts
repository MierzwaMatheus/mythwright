import { estimateTokenCount } from "./tokenCounter";

type Character = {
  name: string;
  aspects: string[];
  skills: Record<string, number>;
  stunts: string[];
  fatePoints: number;
  stress: {
    physical: boolean[];
    mental: boolean[];
  };
  consequences: Array<{
    severity: "mild" | "moderate" | "severe";
    description: string;
  }>;
  [key: string]: unknown;
};

type Scene = {
  title: string;
  description?: string;
  status: "inactive" | "active" | "completed";
  locationId?: string;
  presentEntityIds?: string[];
  [key: string]: unknown;
};

type Entity = {
  name: string;
  visibility: "hidden" | "known";
  description: string;
  type: "npc" | "location" | "faction" | "item" | "concept";
  [key: string]: unknown;
};

type Fact = {
  content: string;
  visibility: "hidden" | "rumored" | "known";
  [key: string]: unknown;
};

export function buildSceneBlock(
  scene: Scene,
  entities: Entity[],
  facts: Fact[]
): {
  location: string;
  aspects: string[];
  npcsPresent: { name: string; description: string }[];
  activeObjectives: never[];
} {
  return {
    location: scene.title,
    aspects: facts
      .filter((f) => f.visibility === "known" || f.visibility === "rumored")
      .map((f) => f.content),
    npcsPresent: entities
      .filter((e) => e.visibility === "known")
      .map((e) => ({ name: e.name, description: e.description })),
    activeObjectives: [],
  };
}

export function buildWorldStateBlock(
  facts: Fact[],
  entities: Entity[]
): {
  world_state_internal: { facts: { content: string }[]; entities: Entity[] };
  player_knowledge: { facts: { content: string }[]; entities: { name: string; description: string }[] };
} {
  return {
    world_state_internal: {
      facts: facts
        .filter((f) => f.visibility === "hidden" || f.visibility === "rumored")
        .map((f) => ({ content: f.content })),
      entities: entities.filter((e) => e.visibility === "hidden"),
    },
    player_knowledge: {
      facts: facts
        .filter((f) => f.visibility === "known")
        .map((f) => ({ content: f.content })),
      entities: entities
        .filter((e) => e.visibility === "known")
        .map((e) => ({ name: e.name, description: e.description })),
    },
  };
}

type Message = {
  role: "user" | "assistant";
  content: string;
  status?: "ok" | "failed" | "pending";
  [key: string]: unknown;
};

export function buildMessageWindow(
  messages: Message[],
  limit: number = 20
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((m) => m.status !== "failed")
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.content }));
}

type Campaign = { name: string; systemPrompt?: string; [key: string]: unknown };
type Summary = { content: string; [key: string]: unknown };
type FiredEvent = { name: string; description?: string; [key: string]: unknown };

type ContextBlock = { role: "system" | "user" | "assistant"; content: string };

export function buildFullContext(
  campaign: Campaign,
  character: Character,
  scene: Scene,
  messages: Message[],
  retrievedFacts: Fact[],
  retrievedSummaries: Summary[],
  firedEvents: FiredEvent[]
): ContextBlock[] {
  const window = buildMessageWindow(messages);

  // Separar a última mensagem user do restante
  const lastUserIdx = window.findLastIndex((m) => m.role === "user");
  const messagesBeforeLast = lastUserIdx >= 0 ? window.slice(0, lastUserIdx) : window;
  const lastUserMessage = lastUserIdx >= 0 ? window[lastUserIdx] : null;

  const result: ContextBlock[] = [];

  // 1. system prompt
  result.push({ role: "system", content: campaign.systemPrompt ?? "" });

  // 2. character block
  result.push({ role: "system", content: buildCharacterBlock(character) });

  // 3. scene block
  result.push({ role: "system", content: JSON.stringify(buildSceneBlock(scene, [], retrievedFacts)) });

  // 4. world state block
  result.push({ role: "system", content: JSON.stringify(buildWorldStateBlock(retrievedFacts, [])) });

  // 5. summaries
  for (const summary of retrievedSummaries) {
    result.push({ role: "system", content: summary.content });
  }

  // 6. messages (exceto a última user)
  for (const msg of messagesBeforeLast) {
    result.push({ role: msg.role, content: msg.content });
  }

  // 7. fired events (se houver)
  if (firedEvents.length > 0) {
    result.push({ role: "system", content: JSON.stringify(firedEvents) });
  }

  // 8. última mensagem user por último
  if (lastUserMessage) {
    result.push({ role: lastUserMessage.role, content: lastUserMessage.content });
  }

  const totalTokens = result.reduce((sum, block) => sum + estimateTokenCount(block.content), 0);
  if (totalTokens > 14000) {
    console.warn(`[buildFullContext] Contexto excede 14k tokens (estimado: ${totalTokens} tokens). Considere reduzir o tamanho do contexto.`);
  }

  return result;
}

export function buildCharacterBlock(character: Character): string {
  return JSON.stringify({
    aspects: character.aspects,
    skills: character.skills,
    stunts: character.stunts,
    fatePoints: character.fatePoints,
    stress: character.stress,
    consequences: character.consequences,
  });
}
