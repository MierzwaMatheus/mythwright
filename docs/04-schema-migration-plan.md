# Mythwright — Schema Migration & Data Plan

**Data:** Maio 2026
**Versão:** 1.0
**Escopo:** Plano completo de evolução do schema atual para o schema-alvo conforme PRD §5.4 e TAD §8. Inclui ordem de migração, estratégia para preservar dados de teste, e seeds de desenvolvimento.

---

## 1. Estado Atual do Schema vs. Estado-Alvo

### 1.1 Resumo das mudanças

A evolução do schema afeta praticamente todas as tabelas. Mudanças críticas:

- **Embeddings + vectorIndex** em 5 tabelas (`messages`, `entities`, `facts`, `triggers`, `summaries`).
- **Reescrita** de `summaries` e `diceRolls` (hoje stubs com apenas `campaignId`).
- **Visibilidade `rumored`** em `entities` (hoje só `hidden|known`).
- **`llmConfig`** em `campaigns`.
- **Campos de auditoria** em `triggers`, `facts`, `messages`.
- **Campo `oneShot`** em `triggers`.
- **Separação `scope` vs. `scopeRefId`** em `triggers`.
- **Stats FATE em NPCs** via campo opcional em `entities`.

Nenhuma tabela é deletada. Nenhuma tabela é renomeada.

### 1.2 Dimensão de embedding

Decisão consolidada: **1024 dimensões** (modelo `bge-m3`). Multilingual, suporta português, padrão open-source robusto.

Este é um ponto **irreversível depois que houver dados em produção**. Convex `vectorIndex` exige dimensão fixa. Trocar o modelo de embedding depois exige migração: re-embedar todos os documentos. Para MVP, ficar em `bge-m3`.

---

## 2. Schema-Alvo Completo

Schema completo conforme TAD/PRD. Salvar como referência e usar como base para escrever `convex/schema.ts` no Sprint 0.

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ========================================
  // IDENTIDADE
  // ========================================

  users: defineTable({
    email: v.string(),
    displayName: v.string(),
    avatar: v.optional(v.string()),
    tokenIdentifier: v.string(),
    encryptedOpenRouterKey: v.optional(v.string()),
  }).index("by_token", ["tokenIdentifier"]),

  // ========================================
  // CAMPANHAS
  // ========================================

  campaigns: defineTable({
    userId: v.id("users"),
    name: v.string(),
    premise: v.string(),
    tone: v.string(),
    expectedDuration: v.union(
      v.literal("one-shot"),
      v.literal("medium"),
      v.literal("long")
    ),
    status: v.union(
      v.literal("setup"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("archived")
    ),
    createdAt: v.number(),
    lastActivityAt: v.number(),

    // Configurações
    cheatModeEnabled: v.optional(v.boolean()),
    antiLeakValidationEnabled: v.optional(v.boolean()),

    // [NOVO] Configuração de modelos LLM
    llmConfig: v.optional(v.object({
      narrativeModel: v.string(),     // ex: "deepseek/deepseek-chat"
      utilityModel: v.string(),        // ex: "meta-llama/llama-3.1-8b-instruct"
      extractionModel: v.string(),     // ex: "qwen/qwen-2.5-32b-instruct"
      embeddingModel: v.string(),      // ex: "baai/bge-m3"
    })),

    // [NOVO] Estado denormalizado para reads rápidos
    currentSceneId: v.optional(v.id("scenes")),
  })
    .index("by_user", ["userId"])
    .index("by_user_activity", ["userId", "lastActivityAt"]),

  // ========================================
  // PERSONAGEM
  // ========================================

  characters: defineTable({
    campaignId: v.id("campaigns"),
    name: v.string(),
    aspects: v.array(v.string()),
    skills: v.record(v.string(), v.number()),
    stunts: v.array(v.string()),
    fatePoints: v.number(),
    stress: v.object({
      physical: v.array(v.boolean()),
      mental: v.array(v.boolean()),
    }),
    consequences: v.array(v.object({
      severity: v.union(
        v.literal("mild"),
        v.literal("moderate"),
        v.literal("severe")
      ),
      description: v.string(),
    })),
  }).index("by_campaign", ["campaignId"]),

  characterEditLogs: defineTable({
    characterId: v.id("characters"),
    field: v.string(),
    oldValue: v.any(),
    newValue: v.any(),
    timestamp: v.number(),
    messageId: v.optional(v.id("messages")),
    reason: v.optional(v.string()),
  }).index("by_character", ["characterId"]),

  // ========================================
  // CENAS E NARRATIVA
  // ========================================

  scenes: defineTable({
    campaignId: v.id("campaigns"),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(
      v.literal("inactive"),
      v.literal("active"),
      v.literal("completed")
    ),
    createdAt: v.number(),
    endedAt: v.optional(v.number()),
    locationId: v.optional(v.id("entities")),
    presentEntityIds: v.optional(v.array(v.id("entities"))),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_campaign_created", ["campaignId", "createdAt"]),

  sceneAspects: defineTable({
    sceneId: v.id("scenes"),
    text: v.string(),
    freeInvokes: v.number(),
  }).index("by_scene", ["sceneId"]),

  messages: defineTable({
    campaignId: v.id("campaigns"),
    sceneId: v.optional(v.id("scenes")),
    role: v.union(
      v.literal("player"),
      v.literal("gm"),
      v.literal("system")
    ),
    content: v.string(),
    clientMessageId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("complete"),
      v.literal("failed"),
      v.literal("leaked")
    ),
    createdAt: v.optional(v.number()),
    finalizedAt: v.optional(v.number()),

    toolCalls: v.optional(v.array(v.object({
      toolName: v.string(),
      toolParams: v.any(),
      toolResult: v.any(),
      executedAt: v.number(),
    }))),

    // [NOVO] Embedding para memória semântica
    embedding: v.optional(v.array(v.float64())),

    // [NOVO] Auditoria e idempotência
    causedByMessageId: v.optional(v.id("messages")),
    triggersFired: v.optional(v.array(v.id("triggers"))),
    factsRevealed: v.optional(v.array(v.id("facts"))),

    // [NOVO] Tracking de tokens
    tokensUsed: v.optional(v.object({
      input: v.number(),
      output: v.number(),
    })),

    // [NOVO] Versão do prompt usado
    promptVersion: v.optional(v.string()),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_campaign_and_clientMessageId", ["campaignId", "clientMessageId"])
    .index("by_scene_and_createdAt", ["sceneId", "createdAt"])
    .index("by_caused_by", ["causedByMessageId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["campaignId", "sceneId"],
    }),

  // ========================================
  // ESTADO DO MUNDO
  // ========================================

  entities: defineTable({
    campaignId: v.id("campaigns"),
    type: v.union(
      v.literal("npc"),
      v.literal("location"),
      v.literal("faction"),
      v.literal("item"),
      v.literal("concept")
    ),
    name: v.string(),
    description: v.string(),

    // [ALTERADO] Adicionar "rumored"
    visibility: v.union(
      v.literal("hidden"),
      v.literal("rumored"),
      v.literal("known")
    ),

    // [NOVO] Stats FATE para NPCs
    npcStats: v.optional(v.object({
      tier: v.union(
        v.literal("nameless"),
        v.literal("supporting"),
        v.literal("main")
      ),
      hiddenMotivation: v.optional(v.string()),
      aspects: v.optional(v.array(v.string())),
      skills: v.optional(v.record(v.string(), v.number())),
      stunts: v.optional(v.array(v.string())),
      stress: v.optional(v.object({
        physical: v.array(v.boolean()),
        mental: v.array(v.boolean()),
      })),
      consequences: v.optional(v.array(v.object({
        severity: v.union(
          v.literal("mild"),
          v.literal("moderate"),
          v.literal("severe")
        ),
        description: v.string(),
      }))),
    })),

    // [NOVO] Relações entre entidades
    relations: v.optional(v.array(v.object({
      targetEntityId: v.id("entities"),
      type: v.string(),
      description: v.optional(v.string()),
    }))),

    // [NOVO] Embedding
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_campaign_and_visibility", ["campaignId", "visibility"])
    .index("by_campaign_and_type", ["campaignId", "type"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["campaignId", "type", "visibility"],
    }),

  facts: defineTable({
    campaignId: v.id("campaigns"),
    content: v.string(),
    visibility: v.union(
      v.literal("hidden"),
      v.literal("rumored"),
      v.literal("known")
    ),
    relatedEntityIds: v.optional(v.array(v.id("entities"))),

    // [NOVO] Auditoria de revelação
    revealedBy: v.optional(v.object({
      messageId: v.id("messages"),
      triggerId: v.optional(v.id("triggers")),
      revealedAt: v.number(),
    })),

    // [NOVO] Categorização
    category: v.optional(v.string()),

    // [NOVO] Embedding
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.optional(v.number()),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_campaign_and_visibility", ["campaignId", "visibility"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["campaignId", "visibility"],
    }),

  triggers: defineTable({
    campaignId: v.id("campaigns"),
    description: v.string(),

    // [ALTERADO] Schema mais estruturado de escopo
    scope: v.union(
      v.literal("global"),
      v.literal("scene"),
      v.literal("location")
    ),
    scopeRefId: v.optional(v.string()),

    effects: v.array(v.object({
      type: v.string(),
      payload: v.any(),
    })),

    status: v.union(
      v.literal("armed"),
      v.literal("disabled"),
      v.literal("fired")
    ),
    firedAt: v.optional(v.number()),

    // [NOVO]
    oneShot: v.boolean(),
    firedByMessageId: v.optional(v.id("messages")),

    // [NOVO]
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_campaign_status_scope", ["campaignId", "status", "scope"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["campaignId", "status", "scope"],
    }),

  // ========================================
  // MEMÓRIA (RESUMOS HIERÁRQUICOS)
  // ========================================

  // [REESCRITO] Schema completo
  summaries: defineTable({
    campaignId: v.id("campaigns"),
    level: v.union(
      v.literal("scene"),
      v.literal("arc"),
      v.literal("campaign")
    ),
    content: v.string(),

    sourceMessageIds: v.optional(v.array(v.id("messages"))),
    sourceSceneIds: v.optional(v.array(v.id("scenes"))),
    sourceSummaryIds: v.optional(v.array(v.id("summaries"))),

    coversFrom: v.number(),
    coversTo: v.number(),

    embedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_campaign_level", ["campaignId", "level"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["campaignId", "level"],
    }),

  // ========================================
  // MECÂNICAS FATE
  // ========================================

  // [REESCRITO] Schema completo de auditoria de rolagens
  diceRolls: defineTable({
    campaignId: v.id("campaigns"),
    messageId: v.id("messages"),

    type: v.union(
      v.literal("attack"),
      v.literal("defend"),
      v.literal("overcome"),
      v.literal("create_advantage")
    ),

    // Entrada
    skillName: v.string(),
    skillLevel: v.number(),
    invokedAspectIds: v.array(v.id("sceneAspects")),
    bonus: v.number(),

    // Resultado (4dF)
    diceResults: v.array(v.number()),
    diceTotal: v.number(),
    finalResult: v.number(),

    // Contexto narrativo
    description: v.string(),
    opposition: v.optional(v.number()),
    outcome: v.optional(v.union(
      v.literal("failure"),
      v.literal("tie"),
      v.literal("success"),
      v.literal("success_with_style")
    )),

    seed: v.string(),
    rolledAt: v.number(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_message", ["messageId"]),

  aspectInvocations: defineTable({
    aspectId: v.id("sceneAspects"),
    targetRollId: v.id("diceRolls"),
    effect: v.union(
      v.literal("bonus_2"),
      v.literal("reroll")
    ),
    payerId: v.id("characters"),
    usesFreeInvoke: v.boolean(),
    invokedAt: v.number(),
  }).index("by_aspect", ["aspectId"]),

  compels: defineTable({
    campaignId: v.id("campaigns"),
    aspectId: v.id("sceneAspects"),
    characterId: v.id("characters"),
    complication: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("refused")
    ),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),

    // [NOVO] Vincular ao turno para continuação
    triggeringMessageId: v.optional(v.id("messages")),
    pausedGmMessageId: v.optional(v.id("messages")),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_character", ["characterId"]),
});
```

---

## 3. Plano de Migração

### 3.1 Princípio orientador

Como o produto está em pré-MVP e dados existentes são dados de teste/desenvolvimento, **não há restrição de preservar dados em produção**. Isso simplifica drasticamente a migração: podemos fazer mudanças destrutivas se necessário.

A estratégia é:
1. Schema novo é deployado de uma vez no ambiente de dev.
2. Dados de teste são limpos via script de reset.
3. Seeds determinísticos são aplicados para repor estado de teste.
4. Testes existentes são ajustados para os novos campos.

### 3.2 Ordem de execução

**Passo 1 — Backup mental do estado atual.** Confirmar com o desenvolvedor que dados em dev podem ser apagados. Se há campanhas de teste valiosas, exportá-las manualmente antes (cheat mode mostraria todo o estado).

**Passo 2 — Atualizar `convex/schema.ts` para o schema-alvo.** Substituir conteúdo. A maioria dos campos novos são `v.optional(...)`, então campanhas existentes continuariam válidas — exceto pelas mudanças de visibility em entities (incompatível) e reescrita de summaries/diceRolls (incompatível).

**Passo 3 — Reset do dev deployment.** Convex CLI: `npx convex dev --reset`. Isso apaga todos os dados.

**Passo 4 — Atualizar testes.** Cada teste que usa visibility de entity precisa aceitar `rumored`. Cada teste que cria triggers precisa fornecer `oneShot`. Cada teste que cria messages pode opcionalmente fornecer `embedding`. Etc.

**Passo 5 — Implementar seeds.** Ver §4.

**Passo 6 — Rodar suite de testes completa.** Ajustar até `npm test` passar.

**Passo 7 — Subir frontend e fazer um turno end-to-end manualmente.** Ainda sem todas as features, mas validar que o schema novo funciona em runtime real.

### 3.3 Mudanças por arquivo de teste

Resumo de quais testes precisam ajuste pelo schema novo:

- `entities.test.ts`, `listEntities.test.ts`: aceitar visibility `rumored` em casos relevantes.
- `triggers.test.ts`: passar `oneShot: true|false` em todos os `createTrigger`. Atualizar para usar enum `scope` em vez de string livre. Adicionar `scopeRefId` quando aplicável.
- `messages.test.ts` e seus relacionados: opcionalmente testar `embedding`. Não obrigatório no MVP de testes.
- Testes de `scenes` que dependem de `summarizeScene`: ajustar para nova implementação real (ou mockar).
- `characters.test.ts`: nada muda no schema do character.
- `campaigns.test.ts`: testar `llmConfig` quando criação de campanha for atualizada.
- Novos arquivos: `summaries.test.ts`, `diceRolls.test.ts`.

### 3.4 Estratégia para deploys futuros (pós-MVP)

Quando houver dados de produção, a estratégia muda. Para cada migração futura:

1. **Aditiva sempre que possível.** Adicionar campos opcionais não quebra dados existentes.
2. **Destrutiva exige migração.** Mudar enum de visibility, por exemplo, exige Convex migration component (`@convex-dev/migrations`) para varrer registros existentes e atualizar.
3. **Mudança de dimensão de embedding** exige re-embedar todos os documentos com vector index. Implementar como job de background com paginação.

A pasta `.agents/skills/convex-migration-helper/` no projeto já tem referências de boas práticas de migração — consultar quando chegar nesse ponto.

---

## 4. Seeds de Desenvolvimento

### 4.1 Propósito

Seeds permitem ter um ambiente de desenvolvimento populado rapidamente: uma campanha completa com personagem, NPCs, fatos hidden e known, gatilhos, e algumas mensagens. Útil para:

- Testar visualmente componentes da UI.
- Reproduzir bugs com estado conhecido.
- Demonstrar o produto sem precisar criar campanha do zero.

### 4.2 Estrutura

Criar `convex/seeds/` com:

```
convex/seeds/
├── index.ts            (orquestrador — chamada principal)
├── users.ts            (usuário de teste)
├── campaigns.ts        (1-2 campanhas exemplo)
├── characters.ts       (personagens das campanhas)
├── scenarios/
│   ├── noir.ts         (cenário noir político urbano)
│   └── fantasy.ts      (cenário fantasia clássica)
└── helpers.ts          (utilities: gerar embeddings, IDs determinísticos)
```

### 4.3 Implementação sugerida

`convex/seeds/index.ts`:

```typescript
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";

/**
 * Seed completo. Apaga dados existentes do usuário de teste e recria.
 * Apenas usável em dev — falha em produção.
 */
export const runDevSeed = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.NODE_ENV === "production") {
      throw new ConvexError("Seeds não podem ser executadas em produção");
    }

    // 1. Cleanup
    await ctx.runMutation(internal.seeds.users.clearTestUser, {});

    // 2. Criar usuário
    const userId = await ctx.runMutation(internal.seeds.users.createTestUser, {});

    // 3. Criar 2 campanhas exemplo
    const noirCampaignId = await ctx.runMutation(internal.seeds.scenarios.noir.create, { userId });
    const fantasyCampaignId = await ctx.runMutation(internal.seeds.scenarios.fantasy.create, { userId });

    return {
      userId,
      campaigns: [noirCampaignId, fantasyCampaignId],
    };
  },
});
```

### 4.4 Cenário exemplo: noir político urbano

`convex/seeds/scenarios/noir.ts` (esqueleto):

```typescript
import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { Id } from "../../_generated/dataModel";

export const create = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // Campanha
    const campaignId = await ctx.db.insert("campaigns", {
      userId: args.userId,
      name: "A Cidade que Não Dorme",
      premise: "Detetive privado em uma cidade portuária dos anos 1920 investiga uma série de desaparecimentos ligados a uma sociedade secreta.",
      tone: "noir político urbano com elementos sobrenaturais sutis",
      expectedDuration: "medium",
      status: "active",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      cheatModeEnabled: true,
      antiLeakValidationEnabled: false, // off em seed para velocidade
      llmConfig: {
        narrativeModel: "deepseek/deepseek-chat",
        utilityModel: "meta-llama/llama-3.1-8b-instruct",
        extractionModel: "qwen/qwen-2.5-32b-instruct",
        embeddingModel: "baai/bge-m3",
      },
    });

    // Personagem
    const characterId = await ctx.db.insert("characters", {
      campaignId,
      name: "Anton Verlaine",
      aspects: [
        "Detetive Cético em Cidade Embruxada",
        "Devo Favores ao Crime Organizado",
        "Memórias da Guerra Não Me Deixam",
        "Olho Treinado para Mentiras",
        "Bebo Mais do Que Deveria",
      ],
      skills: {
        Investigar: 4, Empatia: 3, Notar: 3,
        Comunicar: 2, Vontade: 2, Atletismo: 2,
        Lutar: 1, Contatos: 1, Saber: 1, Sobreviver: 1,
      },
      stunts: [
        "Olho Treinado: +2 em Notar para detectar mentiras visuais quando o alvo está nervoso",
        "Frase Certa, Hora Certa: pode usar Comunicar em vez de Provocar para intimidar com palavras precisas",
        "Sobrevivente: +2 em Vontade quando enfrenta seus próprios traumas de guerra",
      ],
      fatePoints: 3,
      stress: { physical: [false, false, false], mental: [false, false, false] },
      consequences: [],
    });

    // NPCs
    const taberneiraId = await ctx.db.insert("entities", {
      campaignId,
      type: "npc",
      name: "Senhora Marta",
      description: "Dona da Taverna do Porto. Conhece todo mundo, fala pouco. Cabelos grisalhos, olhar atento.",
      visibility: "known",
      npcStats: {
        tier: "supporting",
        hiddenMotivation: "É informante da Sociedade. Reporta sobre Anton.",
      },
    });

    const sociedadeId = await ctx.db.insert("entities", {
      campaignId,
      type: "faction",
      name: "A Ordem do Lampião Negro",
      description: "Grupo elite da cidade que se reúne em encontros restritos. Dizem que protegem 'tradições antigas'.",
      visibility: "rumored",
    });

    const valdrikId = await ctx.db.insert("entities", {
      campaignId,
      type: "npc",
      name: "Valdrik Marsh",
      description: "Mercador desaparecido há duas semanas. Última visto perto do porto.",
      visibility: "rumored",
      npcStats: {
        tier: "supporting",
        hiddenMotivation: "Foi sequestrado pela Ordem ao descobrir a verdade. Vivo, em cativeiro.",
      },
    });

    // Local inicial
    const tavernaId = await ctx.db.insert("entities", {
      campaignId,
      type: "location",
      name: "Taverna do Porto",
      description: "Bar de marinheiros. Cheira a sal e fumaça. Iluminação em querosene, mesas de carvalho gasto.",
      visibility: "known",
    });

    // Fatos
    const factDesaparecimentoId = await ctx.db.insert("facts", {
      campaignId,
      content: "Cinco pessoas desapareceram nas últimas três semanas, todas perto do porto.",
      visibility: "known",
      relatedEntityIds: [],
      category: "background",
      createdAt: Date.now(),
    });

    const factOrdemId = await ctx.db.insert("facts", {
      campaignId,
      content: "A Ordem do Lampião Negro está envolvida nos desaparecimentos.",
      visibility: "hidden",
      relatedEntityIds: [sociedadeId],
      category: "secret",
      createdAt: Date.now(),
    });

    const factValdrikViveId = await ctx.db.insert("facts", {
      campaignId,
      content: "Valdrik Marsh está vivo, prisioneiro em um cativeiro nas catacumbas sob a igreja velha.",
      visibility: "hidden",
      relatedEntityIds: [valdrikId],
      category: "secret",
      createdAt: Date.now(),
    });

    const factMartaInformanteId = await ctx.db.insert("facts", {
      campaignId,
      content: "Senhora Marta é informante da Ordem.",
      visibility: "hidden",
      relatedEntityIds: [taberneiraId, sociedadeId],
      category: "secret",
      createdAt: Date.now(),
    });

    // Triggers
    await ctx.db.insert("triggers", {
      campaignId,
      description: "O jogador menciona o nome 'Valdrik' em conversa com qualquer NPC, ou pergunta sobre o desaparecimento dele",
      scope: "global",
      effects: [
        {
          type: "reveal_fact",
          payload: { factId: factOrdemId },
        },
      ],
      status: "armed",
      oneShot: true,
    });

    await ctx.db.insert("triggers", {
      campaignId,
      description: "O jogador investiga a igreja velha ou suas catacumbas",
      scope: "global",
      effects: [
        {
          type: "reveal_fact",
          payload: { factId: factValdrikViveId },
        },
      ],
      status: "armed",
      oneShot: true,
    });

    await ctx.db.insert("triggers", {
      campaignId,
      description: "O jogador desconfia explicitamente da Senhora Marta ou a confronta",
      scope: "scene",
      scopeRefId: undefined, // qualquer cena na taverna
      effects: [
        {
          type: "reveal_fact",
          payload: { factId: factMartaInformanteId },
        },
      ],
      status: "armed",
      oneShot: true,
    });

    // Cena inicial
    const sceneId = await ctx.db.insert("scenes", {
      campaignId,
      title: "Taverna do Porto, Madrugada",
      description: "Anton bebe whiskey barato no canto da taverna. A chuva bate na janela. Senhora Marta observa de trás do balcão.",
      status: "active",
      createdAt: Date.now(),
      locationId: tavernaId,
      presentEntityIds: [taberneiraId],
    });

    // Aspectos da cena
    await ctx.db.insert("sceneAspects", {
      sceneId,
      text: "Chuva Pesada Lá Fora",
      freeInvokes: 0,
    });

    await ctx.db.insert("sceneAspects", {
      sceneId,
      text: "Clientes Habituais Ouvindo",
      freeInvokes: 0,
    });

    // Atualizar campaign.currentSceneId
    await ctx.db.patch(campaignId, { currentSceneId: sceneId });

    return campaignId;
  },
});
```

### 4.5 Embeddings nos seeds

Seeds inserem dados sem embeddings. Após inserir, agendar uma action de "reembed" que processa cada entidade/fato/trigger/sumário sem embedding e popula:

```typescript
export const reembedAllInCampaign = internalAction({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    // Para cada tabela com embedding, listar items sem embedding e gerar
    const facts = await ctx.runQuery(internal.facts.listWithoutEmbedding, { campaignId: args.campaignId });
    for (const fact of facts) {
      const embedding = await generateEmbedding(fact.content);
      await ctx.runMutation(internal.facts.setEmbedding, { factId: fact._id, embedding });
    }
    // ... entities, triggers, etc.
  },
});
```

Em ambiente local sem chave de embedding, usar embeddings dummy aleatórios para testes:

```typescript
function dummyEmbedding(): number[] {
  return Array.from({ length: 1024 }, () => Math.random() - 0.5);
}
```

### 4.6 Comando para rodar seeds

Adicionar ao `package.json`:

```json
{
  "scripts": {
    "seed": "npx convex run seeds:runDevSeed"
  }
}
```

---

## 5. Estratégia de Testes Pós-Migração

### 5.1 Testes unitários

Os 6.367 linhas de teste existentes precisam ajustes mínimos para os campos opcionais novos. Para os campos obrigatórios novos (`oneShot` em triggers, `level/content/embedding` em summaries, etc), update obrigatório.

Tarefas específicas:

- `triggers.test.ts`: adicionar `oneShot: true` em todos os `createTrigger`.
- `entities.test.ts` e descendentes: incluir cenários com `visibility: "rumored"`.
- `summaries.test.ts`: criar do zero. Cobrir: criação de scene summary, criação de arc summary, hierarquia, idempotência.
- `diceRolls.test.ts`: criar do zero. Cobrir: persistência completa de rolagem, busca por messageId, reproducibilidade via seed.

### 5.2 Testes de integração para vector search

Convex `convex-test` (já em uso) suporta vector search. Testar:

- Inserir N fatos com embeddings determinísticos.
- Executar vector search com embedding de query.
- Validar que top-K retorna os esperados.

Embeddings determinísticos via seeds (não randômicos): definir vetores fixos por categoria conceitual ("personagem", "local", "evento") e verificar que busca por "personagem-like" retorna preferentemente os de mesma categoria.

### 5.3 Testes de migração futura

Para futuras migrações em produção, criar dataset golden em formato JSON snapshot do estado do banco antes da migração. Rodar migração em fixture, comparar resultado com snapshot esperado.

Para o MVP, isso é overkill — fica como prática para v1+.

---

## 6. Riscos e Mitigação

### 6.1 Vector search latência em campanhas grandes

**Risco:** Em campanhas com 10k+ fatos, vector search pode lentificar.

**Mitigação:** Convex documenta que vectorIndex é otimizado e escala bem. Monitorar empiricamente. Se virar gargalo, considerar:
- Filtros mais agressivos no `filterFields`.
- Pre-filtro por relação direta a entidades presentes na cena.
- Embeddings de menor dimensão (não trivial, requer re-embed).

### 6.2 Custo de geração de embeddings

**Risco:** Cada turno gera ≥1 embedding (mensagem do jogador). Cada novo fato/entidade/trigger gera 1. Em campanhas longas, isso acumula.

**Mitigação:**
- `bge-m3` via Together AI ou similar é barato (~$0.0001 por 1k tokens). Negligível.
- Self-hosted fallback se necessário (HuggingFace TGI em runtime próprio).

### 6.3 Mudança de modelo de embedding

**Risco:** Se decidirmos mudar `bge-m3` para outro modelo, dimensão muda, todo o vector index quebra.

**Mitigação:**
- Decidir cedo (agora) e travar.
- Se inevitável, planejar migração: criar nova tabela com novo schema, re-embedar tudo, fazer cutover atômico via mudança de query.

### 6.4 Tamanho do schema crescer demais

**Risco:** À medida que features são adicionadas, schema pode virar bagunça.

**Mitigação:**
- Manter docstrings em cada tabela.
- Considerar separar em arquivos por domínio quando passar de ~20 tabelas (`schema.identity.ts`, `schema.world.ts`, etc).
- Para v2+, considerar Convex schema validators externos.

---

## 7. Checklist de Execução do Sprint 0

Para o desenvolvedor, na ordem:

- [ ] Confirmar que dados de dev podem ser apagados.
- [ ] Substituir `convex/schema.ts` pelo schema-alvo desta seção 2.
- [ ] Resetar deployment dev (`npx convex dev --reset`).
- [ ] Atualizar tests que falham:
  - [ ] `triggers.test.ts` — adicionar `oneShot`, ajustar `scope`.
  - [ ] Outros tests conforme erros do `npm test`.
- [ ] Implementar `convex/seeds/` conforme §4.
- [ ] Implementar `convex/lib/embedding.ts` (esboço — pode usar dummy embeddings inicialmente).
- [ ] Implementar `convex/lib/vectorSearch.ts` (helper).
- [ ] Implementar `summaries.ts` e `diceRolls.ts` com mutations/queries básicas.
- [ ] Rodar `npm test` — passa 100%.
- [ ] Rodar `npm run seed` — campanha de noir aparece.
- [ ] Verificar via Convex Dashboard que dados estão corretos.
- [ ] Próximo sprint pode começar.

---

**Fim do Schema Migration & Data Plan.**
