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
