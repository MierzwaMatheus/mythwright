import { describe, test, expect } from "vitest";
import { buildCharacterBlock, buildSceneBlock, buildWorldStateBlock, buildMessageWindow } from "./contextBuilder";

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

describe("buildWorldStateBlock", () => {
  const hiddenFact = {
    content: "O rei é um vampiro",
    visibility: "hidden" as const,
  };

  const rumoredFact = {
    content: "Dizem que há um dragão nas montanhas",
    visibility: "rumored" as const,
  };

  const knownFact = {
    content: "A guerra terminou há três anos",
    visibility: "known" as const,
  };

  const hiddenEntity = {
    name: "Culto das Sombras",
    visibility: "hidden" as const,
    description: "Organização secreta que controla o reino",
    type: "faction" as const,
    secrets: "Eles planejam invocar um deus antigo",
  };

  const knownEntity = {
    name: "Guilda dos Mercadores",
    visibility: "known" as const,
    description: "Associação de comerciantes influentes",
    type: "faction" as const,
  };

  test("isolamento critico: fatos e entidades hidden nunca vazam para player_knowledge", () => {
    const result = buildWorldStateBlock(
      [hiddenFact, rumoredFact, knownFact],
      [hiddenEntity, knownEntity]
    );

    // player_knowledge nao deve conter nada hidden
    const playerFactContents = result.player_knowledge.facts.map(
      (f: { content: string }) => f.content
    );
    expect(playerFactContents).not.toContain(hiddenFact.content);

    const playerEntityNames = result.player_knowledge.entities.map(
      (e: { name: string }) => e.name
    );
    expect(playerEntityNames).not.toContain(hiddenEntity.name);

    // world_state_internal deve conter hidden e rumored
    const internalFactContents = result.world_state_internal.facts.map(
      (f: { content: string }) => f.content
    );
    expect(internalFactContents).toContain(hiddenFact.content);
    expect(internalFactContents).toContain(rumoredFact.content);
    expect(internalFactContents).not.toContain(knownFact.content);

    // world_state_internal deve conter entidades hidden
    const internalEntityNames = result.world_state_internal.entities.map(
      (e: { name: string }) => e.name
    );
    expect(internalEntityNames).toContain(hiddenEntity.name);
    expect(internalEntityNames).not.toContain(knownEntity.name);
  });

  test("player_knowledge.entities contem apenas name e description", () => {
    const result = buildWorldStateBlock([], [knownEntity]);

    expect(result.player_knowledge.entities[0]).toEqual({
      name: "Guilda dos Mercadores",
      description: "Associação de comerciantes influentes",
    });
    expect(result.player_knowledge.entities[0]).not.toHaveProperty("type");
    expect(result.player_knowledge.entities[0]).not.toHaveProperty("visibility");
  });

  test("world_state_internal.entities inclui todos os campos da entidade hidden", () => {
    const result = buildWorldStateBlock([], [hiddenEntity]);

    const entity = result.world_state_internal.entities[0];
    expect(entity.name).toBe("Culto das Sombras");
    expect(entity.description).toBe("Organização secreta que controla o reino");
    expect(entity.secrets).toBe("Eles planejam invocar um deus antigo");
  });

  test("arrays vazios retornam blocos com arrays vazios", () => {
    const result = buildWorldStateBlock([], []);

    expect(result.world_state_internal.facts).toEqual([]);
    expect(result.world_state_internal.entities).toEqual([]);
    expect(result.player_knowledge.facts).toEqual([]);
    expect(result.player_knowledge.entities).toEqual([]);
  });

  test("player_knowledge.facts contem apenas fatos known", () => {
    const result = buildWorldStateBlock([hiddenFact, rumoredFact, knownFact], []);

    expect(result.player_knowledge.facts).toHaveLength(1);
    expect(result.player_knowledge.facts[0].content).toBe(knownFact.content);
  });
});

describe("buildMessageWindow", () => {
  function makeMessage(
    index: number,
    opts: { role?: "user" | "assistant"; status?: "ok" | "failed" | "pending" } = {}
  ) {
    return {
      role: (opts.role ?? (index % 2 === 0 ? "user" : "assistant")) as "user" | "assistant",
      content: `message-${index}`,
      status: opts.status ?? "ok",
      _id: `msg:${index}`,
      _creationTime: index,
    };
  }

  test("retorna as últimas 20 mensagens de um histórico de 30, excluindo failed antes de aplicar o limite", () => {
    // Cria 30 mensagens: mensagens de índice 5, 15 e 25 são failed
    const messages = Array.from({ length: 30 }, (_, i) => {
      const isFailed = i === 5 || i === 15 || i === 25;
      return makeMessage(i, { status: isFailed ? "failed" : "ok" });
    });

    // Após filtrar os 3 failed, restam 27 mensagens válidas (índices 0..4, 6..14, 16..24, 26..29)
    // As últimas 20 dessas 27 são as de índice 7..14, 16..24, 26..29
    const result = buildMessageWindow(messages, 20);

    expect(result).toHaveLength(20);

    // Nenhuma mensagem failed deve aparecer
    const contents = result.map((m) => m.content);
    expect(contents).not.toContain("message-5");
    expect(contents).not.toContain("message-15");
    expect(contents).not.toContain("message-25");

    // A última mensagem deve ser message-29 (última do histórico, não-failed)
    expect(result[result.length - 1].content).toBe("message-29");

    // Cada item deve ter apenas role e content
    result.forEach((m) => {
      expect(m).toHaveProperty("role");
      expect(m).toHaveProperty("content");
      expect(m).not.toHaveProperty("status");
      expect(m).not.toHaveProperty("_id");
      expect(m).not.toHaveProperty("_creationTime");
    });
  });
});
