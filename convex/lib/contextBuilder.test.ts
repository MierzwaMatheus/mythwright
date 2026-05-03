import { describe, test, expect } from "vitest";
import { buildCharacterBlock, buildSceneBlock, buildWorldStateBlock, buildMessageWindow, buildFullContext } from "./contextBuilder";

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

describe("buildFullContext", () => {
  const baseCampaign = {
    name: "A Queda dos Deuses",
    systemPrompt: "Você é um narrador de RPG sombrio e épico.",
  };

  const baseScene = {
    title: "Taverna do Lobo Cinza",
    description: "Uma taverna mal iluminada no porto",
    status: "active" as const,
  };

  const baseFacts: Array<{ content: string; visibility: "hidden" | "rumored" | "known" }> = [
    { content: "A taverna serve como ponto de encontro", visibility: "known" },
    { content: "O dono é um espião", visibility: "hidden" },
  ];

  const baseSummaries = [
    { content: "O herói chegou à cidade após longa jornada." },
    { content: "Encontrou um misterioso informante." },
  ];

  const baseMessages: Array<{ role: "user" | "assistant"; content: string; status: "ok" }> = [
    { role: "assistant", content: "Bem-vindo à taverna.", status: "ok" },
    { role: "user", content: "Procuro informações sobre o dragão.", status: "ok" },
  ];

  const baseFiredEvents = [
    { name: "dragon_spotted", description: "Um dragão foi avistado ao norte." },
  ];

  test("ordem dos blocos: systemPrompt → character → scene → worldState → summaries → messages(menos última user) → firedEvents → última mensagem user", () => {
    const result = buildFullContext(
      baseCampaign,
      baseCharacter,
      baseScene,
      baseMessages,
      baseFacts,
      baseSummaries,
      baseFiredEvents
    );

    // Índice 0: systemPrompt
    expect(result[0]).toEqual({ role: "system", content: baseCampaign.systemPrompt });

    // Índice 1: character block
    expect(result[1]).toEqual({ role: "system", content: buildCharacterBlock(baseCharacter) });

    // Índice 2: scene block
    expect(result[2]).toEqual({
      role: "system",
      content: JSON.stringify(buildSceneBlock(baseScene, [], baseFacts)),
    });

    // Índice 3: world state block
    expect(result[3]).toEqual({
      role: "system",
      content: JSON.stringify(buildWorldStateBlock(baseFacts, [])),
    });

    // Índices 4 e 5: summaries
    expect(result[4]).toEqual({ role: "system", content: baseSummaries[0].content });
    expect(result[5]).toEqual({ role: "system", content: baseSummaries[1].content });

    // Índice 6: primeira mensagem do window (assistant)
    expect(result[6]).toEqual({ role: "assistant", content: "Bem-vindo à taverna." });

    // Índice 7: fired events (antes da última mensagem user)
    expect(result[7]).toEqual({ role: "system", content: JSON.stringify(baseFiredEvents) });

    // Índice 8 (último): última mensagem user
    expect(result[8]).toEqual({ role: "user", content: "Procuro informações sobre o dragão." });
    expect(result).toHaveLength(9);
  });

  test("estimativa de tokens para campanha de 100 turnos não ultrapassa 16.000 tokens", () => {
    // Simula 100 turnos (200 mensagens: user + assistant alternados)
    const heavyMessages: Array<{ role: "user" | "assistant"; content: string; status: "ok" }> =
      Array.from({ length: 200 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: i % 2 === 0
          ? "Examino o ambiente ao redor e procuro pistas sobre o desaparecimento do mercador. Verifico mesas, falo com NPCs próximos e busco objetos suspeitos."
          : "Você varre o ambiente com olhos treinados. Uma mancha escura no canto chama sua atenção — parece sangue recente. A taverneira desvia o olhar quando você a observa. No balcão, um cálice virado ainda tem resquícios de vinho tinto.",
        status: "ok",
      }));

    // 10 summaries de parágrafos típicos de resumo de sessão
    const heavySummaries = Array.from({ length: 10 }, (_, i) => ({
      content: `Sessão ${i + 1}: O grupo enfrentou desafios significativos ao investigar as ruínas antigas. Descobriram artefatos de uma civilização perdida e travaram batalhas contra criaturas das sombras. O mistério da cidade subterrânea começa a se desvendar.`,
    }));

    // 5 fatos conhecidos
    const heavyFacts: Array<{ content: string; visibility: "hidden" | "rumored" | "known" }> =
      Array.from({ length: 5 }, (_, i) => ({
        content: `Fato ${i + 1}: informação importante sobre o mundo do jogo que o personagem conhece e que influencia suas decisões.`,
        visibility: "known",
      }));

    const heavyFiredEvents = [
      { name: "major_battle", description: "Uma batalha épica eclodiu nas ruas da cidade. Os exércitos se chocam e o destino do reino pende por um fio." },
    ];

    const result = buildFullContext(
      { name: "Campanha Pesada", systemPrompt: "Você é um narrador de RPG épico e detalhista. Sua missão é criar uma narrativa envolvente e consistente, mantendo a coerência do mundo e dos personagens ao longo de toda a campanha." },
      baseCharacter,
      baseScene,
      heavyMessages,
      heavyFacts,
      heavySummaries,
      heavyFiredEvents
    );

    const totalChars = result.reduce((sum, block) => sum + block.content.length, 0);
    const estimatedTokens = Math.ceil(totalChars / 4);

    expect(estimatedTokens).toBeLessThanOrEqual(16000);
  });
});
