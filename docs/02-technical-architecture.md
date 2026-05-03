# Mythwright — Technical Architecture Document

**Data:** Maio 2026
**Versão:** 1.0
**Escopo:** Documento técnico de referência durante implementação. Pseudocódigo executável dos 8 estágios do `processTurn`, contratos internos, padrões de orquestração e integração com OpenRouter.

---

## 1. Princípios Arquiteturais

Antes de detalhar componentes, estabelecer os princípios que guiam decisões pontuais durante implementação.

**Convex como single source of truth.** Toda lógica de negócio que persiste estado roda em Convex (mutations e actions). Frontend é projeção reativa do estado. Não há cache local persistente além do Convex Client cache padrão.

**Actions para qualquer fetch externo.** Mutations e queries não fazem `fetch`. Toda chamada a OpenRouter, embedding API, ou qualquer rede sai de uma `internalAction` ou `action`. Isso não é estilo: é constraint do runtime do Convex.

**Mutations são unidade de transação.** Tudo que precisa atomicidade vai junto na mesma mutation. Operações que envolvem múltiplas mutations não são atômicas e exigem desenho cuidadoso para idempotência e recuperação.

**Determinismo onde for auditável.** FATE engine é puro (no `packages/fate-engine`), não toca em nada externo, e todo input gera mesmo output dado a mesma seed. Isso é testado e mantido.

**Tudo que pode ser idempotente, é.** Mensagens são deduplicadas por `clientMessageId`. Turnos são deduplicados pelo ID da mensagem do jogador. Operações repetidas por retry de cliente ou re-agendamento de action não geram efeitos duplicados.

**Streaming como first-class.** A experiência do jogador depende de feedback rápido. Tokens são persistidos incrementalmente para que o cliente, via subscription Convex, veja a resposta sendo escrita.

---

## 2. Visão Geral do Sistema

### 2.1 Topologia

```
┌──────────────────┐       ┌────────────────────┐       ┌──────────────────┐
│                  │       │                    │       │                  │
│  React Frontend  │◄─────►│   Convex Backend   │◄─────►│   OpenRouter     │
│  (Vite + TS)     │       │   (DB + Functions) │       │   (LLM gateway)  │
│                  │       │                    │       │                  │
└──────────────────┘       └────────────────────┘       └──────────────────┘
                                     │
                                     ▼
                            ┌────────────────────┐
                            │ Embedding Provider │
                            │ (Together / HF)    │
                            └────────────────────┘
```

Frontend conecta ao Convex via WebSocket persistente. Convex executa funções (queries reativas, mutations transacionais, actions com side effects). Actions chamam OpenRouter para inferência LLM e provider de embeddings (Together AI ou Hugging Face Inference) para geração de vetores.

### 2.2 Domínios

O backend é organizado em domínios funcionais, cada um com seu módulo `convex/`:

- **Identidade:** `users.ts`, `lib/auth.ts`, `lib/crypto.ts`. Auth, perfil, BYOK.
- **Campanhas:** `campaigns.ts`. Lifecycle, configuração, ownership.
- **Personagens:** `characters.ts`. Ficha FATE, estado, log de mudanças.
- **Mundo:** `entities.ts`, `facts.ts`, `triggers.ts`. Estado do universo de cada campanha.
- **Cenas e narrativa:** `scenes.ts`, `messages.ts`, `summaries.ts` (a criar).
- **Mecânicas FATE:** `aspectInvocations.ts`, `compels.ts`, `consequences.ts`, `sceneAspects.ts`, `stress.ts`, `diceRolls.ts` (a criar).
- **Orquestração:** `processTurn.ts`, `tools/` (a criar), `prompts/`.
- **Memória:** `lib/embedding.ts` (a criar), `lib/contextBuilder.ts`, `lib/vectorSearch.ts` (a criar).
- **Utilidades:** `lib/tokenCounter.ts`, `lib/llmClient.ts` (a criar para abstrair OpenRouter).

### 2.3 FATE Engine isolado

Lógica determinística do FATE vive em `packages/fate-engine/`, completamente separada do Convex. Razões: testabilidade isolada, reusabilidade futura (mobile, CLI), e isolamento de bugs (rolagens nunca são afetadas por mudanças no backend).

Atualmente exporta: `rollFateDice`, `calculateOutcome`, `applyAspectInvocation`, `calculateStress`, `filterTriggerCandidates`. Implementação simples, testes ricos.

---

## 3. O Loop de Turno em Detalhe

Esta seção é o coração do TAD. Cada estágio é descrito com pseudocódigo executável mostrando contratos, dependências, erros possíveis, e padrões.

### 3.1 Visão geral

```
mutation sendMessage(campaignId, content, clientMessageId)
   │
   │ persiste mensagem do jogador (status: pending)
   │ agenda action processTurn
   │
   ▼
action processTurn(playerMessageId)
   │
   ├── Estágio 2: montagem do contexto (paralelo)
   ├── Estágio 3: resolução de gatilhos
   ├── Estágio 4: geração da resposta com tools (streaming)
   ├── Estágio 5: validação anti-vazamento (paralelo a 6)
   ├── Estágio 6: extração de fatos (paralelo a 5)
   ├── Estágio 7: housekeeping (mutation)
   └── Estágio 8: agendar resumos se threshold (background)
```

### 3.2 Estágio 1 — Recepção (mutation)

**Função:** `messages.sendPlayerMessage` (renomear `messages.createMessage` ou adicionar wrapper que também agenda action).

**Contrato:**

```typescript
export const sendPlayerMessage = mutation({
  args: {
    campaignId: v.id("campaigns"),
    sceneId: v.id("scenes"),
    content: v.string(),
    clientMessageId: v.string(),
  },
  handler: async (ctx, args): Promise<{ messageId: Id<"messages"> }> => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");

    // Validar ownership
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.userId !== user._id) {
      throw new ConvexError("Unauthorized");
    }
    if (campaign.status !== "active") {
      throw new ConvexError(`Campaign not active: ${campaign.status}`);
    }

    // Idempotência: dedup por clientMessageId
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_campaign_and_clientMessageId", (q) =>
        q.eq("campaignId", args.campaignId).eq("clientMessageId", args.clientMessageId)
      )
      .unique();

    if (existing) return { messageId: existing._id };

    const messageId = await ctx.db.insert("messages", {
      campaignId: args.campaignId,
      sceneId: args.sceneId,
      role: "player",
      content: args.content,
      clientMessageId: args.clientMessageId,
      status: "complete", // mensagem do jogador é sempre completa imediatamente
      createdAt: Date.now(),
    });

    // Agendar processamento em background
    await ctx.scheduler.runAfter(0, internal.processTurn.processTurn, {
      playerMessageId: messageId,
      campaignId: args.campaignId,
    });

    // Atualizar lastActivityAt
    await ctx.db.patch(args.campaignId, { lastActivityAt: Date.now() });

    return { messageId };
  },
});
```

**Pontos críticos:**

- Mensagem do jogador é `status: "complete"` desde o início. Não há estado pending para mensagem do jogador — ela é fato consumado.
- A action processTurn recebe apenas `playerMessageId`. Tudo mais é re-derivado dela. Isso simplifica idempotência (action pode ser re-executada sem que cliente reenvie nada).
- Validação de status da campanha aqui: não permite enviar mensagem em campanha pausada ou arquivada.

### 3.3 Estágio 2 — Montagem do Contexto (action)

**Função:** `processTurn.buildTurnContext` (helper interno chamado dentro do `processTurn`).

**Pseudocódigo:**

```typescript
async function buildTurnContext(
  ctx: ActionCtx,
  playerMessageId: Id<"messages">
): Promise<TurnContext> {
  // 1. Busca paralela inicial (sem dependências entre si)
  const [
    playerMessage,
    campaign,
    character,
    activeScene,
    recentMessages,
  ] = await Promise.all([
    ctx.runQuery(internal.messages.getById, { messageId: playerMessageId }),
    ctx.runQuery(internal.campaigns.getByMessageId, { messageId: playerMessageId }),
    ctx.runQuery(internal.characters.getByCampaignId, { campaignId }), // injetar campaignId
    ctx.runQuery(internal.scenes.getActiveScene, { campaignId }),
    ctx.runQuery(internal.messages.getRecentByScene, {
      sceneId: activeScene._id,
      limit: 20,
    }),
  ]);

  // 2. Embedding da mensagem do jogador
  const playerEmbedding = await generateEmbedding(playerMessage.content);

  // Persistir embedding na mensagem (uso futuro em sumários)
  await ctx.runMutation(internal.messages.setEmbedding, {
    messageId: playerMessageId,
    embedding: playerEmbedding,
  });

  // 3. Buscas semânticas paralelas
  const [
    relevantSummaries,
    relevantKnownFacts,
    relevantHiddenFacts,
    relevantEntities,
    candidateTriggers,
  ] = await Promise.all([
    vectorSearch(ctx, "summaries", {
      embedding: playerEmbedding,
      filters: { campaignId },
      k: 5,
    }),
    vectorSearch(ctx, "facts", {
      embedding: playerEmbedding,
      filters: { campaignId, visibility: "known" },
      k: 8,
    }),
    vectorSearch(ctx, "facts", {
      embedding: playerEmbedding,
      filters: { campaignId, visibility: "hidden" },
      k: 5,
    }),
    vectorSearch(ctx, "entities", {
      embedding: playerEmbedding,
      filters: { campaignId },
      k: 5,
    }),
    findCandidateTriggers(ctx, campaignId, activeScene._id, playerEmbedding),
  ]);

  return {
    playerMessage,
    campaign,
    character,
    activeScene,
    recentMessages,
    playerEmbedding,
    relevantSummaries,
    relevantKnownFacts,
    relevantHiddenFacts, // usado apenas internamente; nunca exposto ao prompt do GM como conhecimento do jogador
    relevantEntities,
    candidateTriggers,
  };
}
```

**Pontos críticos:**

- Toda query Convex de leitura aqui é via `ctx.runQuery(internal...)` — porque estamos em action, não em query. Internal queries são mais baratas que public queries.
- Vector search só funciona em actions (`ctx.vectorSearch`), o que é nosso caso.
- Embedding é persistido na mensagem do jogador. Razão: ao gerar sumário de cena depois, sumário usa esses embeddings já materializados.
- `relevantHiddenFacts` é coletado aqui mas não vai pro prompt do GM como `player_knowledge`. Vai pro bloco `world_state_internal` (uso interno do GM) e para o validador anti-vazamento. Crítico não confundir.
- `findCandidateTriggers` faz pré-filtro determinístico (status=armed, escopo aplicável) + top-K vetorial. Detalhe em §3.4.

**Tipo `TurnContext`** é o objeto que viaja entre estágios. Definir em `convex/lib/types.ts`.

### 3.4 Estágio 3 — Resolução de Gatilhos (action)

**Função:** `processTurn.resolveTriggersForTurn`.

**Pseudocódigo:**

```typescript
async function resolveTriggersForTurn(
  ctx: ActionCtx,
  context: TurnContext
): Promise<TriggerResolutionResult> {
  if (context.candidateTriggers.length === 0) {
    return { firedTriggerIds: [], revealedFactIds: [], otherEffects: [] };
  }

  // Classificação por LLM utilitário
  const prompt = buildTriggerClassificationPrompt(
    context.playerMessage.content,
    context.activeScene,
    context.candidateTriggers
  );

  const response = await callLlm({
    model: context.campaign.llmConfig.utilityModel,
    messages: [{ role: "user", content: prompt }],
    forceJsonResponse: true,
  });

  const { ativados, raciocinio } = parseTriggerClassification(response);

  if (ativados.length === 0) {
    return { firedTriggerIds: [], revealedFactIds: [], otherEffects: [] };
  }

  // Executar efeitos de cada gatilho disparado
  const result: TriggerResolutionResult = {
    firedTriggerIds: [],
    revealedFactIds: [],
    otherEffects: [],
  };

  for (const triggerId of ativados) {
    const effects = await ctx.runMutation(internal.triggers.fireTrigger, {
      triggerId,
      firedByMessageId: context.playerMessage._id,
    });
    result.firedTriggerIds.push(triggerId);
    result.revealedFactIds.push(...effects.revealedFactIds);
    result.otherEffects.push(...effects.others);
  }

  return result;
}
```

**Função interna `triggers.fireTrigger`** (mutation):

```typescript
export const fireTrigger = internalMutation({
  args: {
    triggerId: v.id("triggers"),
    firedByMessageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const trigger = await ctx.db.get(args.triggerId);
    if (!trigger || trigger.status !== "armed") {
      return { revealedFactIds: [], others: [] };
    }

    const result = { revealedFactIds: [] as Id<"facts">[], others: [] as any[] };

    for (const effect of trigger.effects) {
      switch (effect.type) {
        case "reveal_fact": {
          await ctx.db.patch(effect.payload.factId, { visibility: "known" });
          // Registrar revealedBy
          await ctx.db.patch(effect.payload.factId, {
            revealedBy: {
              messageId: args.firedByMessageId,
              triggerId: args.triggerId,
              revealedAt: Date.now(),
            },
          });
          result.revealedFactIds.push(effect.payload.factId);
          break;
        }
        case "reveal_entity": {
          await ctx.db.patch(effect.payload.entityId, { visibility: "known" });
          break;
        }
        case "change_visibility": {
          // ... aplicar mudança específica
        }
        // Outros efeitos
      }
    }

    // Marcar trigger
    if (trigger.oneShot) {
      await ctx.db.patch(args.triggerId, {
        status: "fired",
        firedAt: Date.now(),
        firedByMessageId: args.firedByMessageId,
      });
    }
    // Se não é oneShot, fica armed para disparar de novo

    return result;
  },
});
```

**Pré-filtro + top-K** vive em `triggers.findCandidateTriggers`:

```typescript
export const findCandidateTriggers = internalAction({
  args: {
    campaignId: v.id("campaigns"),
    sceneId: v.id("scenes"),
    embedding: v.array(v.float64()),
    k: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<TriggerCandidate[]> => {
    // Vector search com filtros já reduz pelo escopo
    const results = await ctx.vectorSearch("triggers", "by_embedding", {
      vector: args.embedding,
      limit: args.k ?? 10,
      filter: (q) =>
        q.eq("campaignId", args.campaignId).eq("status", "armed"),
    });

    // Pós-filtro de escopo: triggers com scope=global OU scope=scene + scopeRefId=sceneId
    const triggers = await Promise.all(
      results.map((r) => ctx.runQuery(internal.triggers.getById, { triggerId: r._id }))
    );

    return triggers.filter((t) =>
      t && (t.scope === "global" ||
            (t.scope === "scene" && t.scopeRefId === args.sceneId))
    );
  },
});
```

### 3.5 Estágio 4 — Geração da Resposta com Tools e Streaming

Este é o estágio mais complexo. Combina streaming, tool calling, persistência incremental, e tratamento de compel pendente.

**Função:** `processTurn.generateGmResponse`.

**Pseudocódigo:**

```typescript
async function generateGmResponse(
  ctx: ActionCtx,
  context: TurnContext,
  triggerResult: TriggerResolutionResult
): Promise<GmResponseResult> {
  // 1. Criar mensagem do GM em status pending
  const gmMessageId = await ctx.runMutation(internal.messages.createGmStub, {
    campaignId: context.campaign._id,
    sceneId: context.activeScene._id,
    causedByMessageId: context.playerMessage._id,
  });

  // 2. Montar mensagens para o LLM
  const messages = buildLlmMessages(context, triggerResult);

  // 3. Catálogo de tools
  const tools = getFateTools();

  // 4. Loop de streaming + tool calling
  const conversation = [...messages]; // mutável durante o loop
  let toolCallSequence = 0;

  while (true) {
    const stream = await openRouterStream({
      model: context.campaign.llmConfig.narrativeModel,
      messages: conversation,
      tools,
      stream: true,
    });

    let pendingToolCall: ToolCall | null = null;
    let textBuffer = "";
    let lastFlushAt = Date.now();

    for await (const chunk of stream) {
      if (chunk.type === "text_delta") {
        textBuffer += chunk.delta;

        // Flush a cada 100ms ou 50 tokens
        const now = Date.now();
        if (now - lastFlushAt >= 100 || textBuffer.length >= 200) {
          await ctx.runMutation(internal.messages.appendMessageTokens, {
            messageId: gmMessageId,
            tokens: textBuffer,
          });
          textBuffer = "";
          lastFlushAt = now;
        }
      }

      if (chunk.type === "tool_call") {
        pendingToolCall = chunk.toolCall;
        // Não interromper, deixar stream completar (modelos podem chamar ferramenta no meio)
      }
    }

    // Flush final
    if (textBuffer.length > 0) {
      await ctx.runMutation(internal.messages.appendMessageTokens, {
        messageId: gmMessageId,
        tokens: textBuffer,
      });
    }

    // Se há tool call, executar
    if (pendingToolCall) {
      const toolResult = await executeFateTool(
        ctx,
        pendingToolCall,
        {
          campaignId: context.campaign._id,
          messageId: gmMessageId,
          characterId: context.character._id,
          sceneId: context.activeScene._id,
          toolCallSequence: toolCallSequence++,
        }
      );

      // Tratamento especial: compel_aspect interrompe o turno
      if (pendingToolCall.name === "compel_aspect") {
        return {
          messageId: gmMessageId,
          status: "awaiting_player_decision",
          compelId: toolResult.compelId,
        };
      }

      // Persistir tool call + resultado
      await ctx.runMutation(internal.messages.appendToolCall, {
        messageId: gmMessageId,
        toolName: pendingToolCall.name,
        toolParams: pendingToolCall.params,
        toolResult,
      });

      // Adicionar resultado à conversação para continuar
      conversation.push({
        role: "assistant",
        content: null,
        tool_calls: [pendingToolCall],
      });
      conversation.push({
        role: "tool",
        tool_call_id: pendingToolCall.id,
        content: JSON.stringify(toolResult),
      });

      // Continuar loop (modelo continuará a narrativa com resultado)
      continue;
    }

    // Sem tool call: stream terminou e resposta está completa
    break;
  }

  return { messageId: gmMessageId, status: "complete" };
}
```

**Pontos críticos:**

- **Idempotência da mensagem do GM:** se o action for reagendada, ela cria nova mensagem GM. Para evitar isso, antes de criar, checar se já existe mensagem GM com `causedByMessageId == playerMessage._id`. Se existir, abortar a execução (já há resposta).
- **Flush batched:** appends frequentes saturam o sistema. 100ms ou 200 chars é regra-de-bolso ajustável.
- **Tool calling interleaved com texto:** modelos podem chamar tool no meio da resposta. O loop trata corretamente. Compel interrompe imediatamente; outras tools voltam pro loop.
- **Conversação mutável:** mantemos `conversation` mutável dentro do loop para incluir tool results. Não persistimos conversação inteira — apenas a mensagem final do GM com `toolCalls` agregadas.

### 3.6 Estágio 5 — Validação Anti-Vazamento (action, paralela a 6)

**Função:** já existe (`prompts.antiLeak.validateAntiLeak`). Ajustes necessários:

```typescript
// Antes de chamar, filtrar hidden facts relevantes
const relevantHiddenFactsForLeak = context.relevantHiddenFacts.map(f => ({
  id: f._id,
  content: f.content,
}));

const leakResult = await ctx.runAction(internal.prompts.antiLeak.validateAntiLeak, {
  messageId: gmMessageId,
  hiddenFacts: relevantHiddenFactsForLeak,
  utilityModel: context.campaign.llmConfig.utilityModel, // novo: passar modelo
});

if (leakResult.vazou && attemptNumber < MAX_REGEN) {
  // Marcar como leaked, regenerar
  await ctx.runMutation(internal.processTurn.markMessageStatus, {
    messageId: gmMessageId,
    status: "leaked",
  });
  // Volta ao Estágio 4 com instrução adicional
  return { needsRegeneration: true, leakedFacts: leakResult.facts };
}
```

**Pontos críticos:**

- Validação só é feita se `campaign.antiLeakValidationEnabled === true`. Default: true para campanhas com hidden facts; false para validação rápida em testes.
- Regeneração é limitada a 2 tentativas (MAX_REGEN = 2 → 3 chamadas totais). Após isso, marcar como `failed`.
- Estágio 5 é paralelo ao 6 quando regeneração não é necessária. Se for necessária, 6 é cancelado e o ciclo recomeça em 4.

### 3.7 Estágio 6 — Extração de Fatos (action, paralela a 5)

Já implementado em `prompts.factExtraction.extractAndPersistFacts`. Ajustes:

- Receber `utilityModel` da campaign config.
- Após persistir fatos, gerar embeddings para cada fato novo (em background, não bloqueante).
- Hoje retorna `Id<"facts">[]`. Manter contrato.

```typescript
// Ajuste: gerar embeddings em background
const factIds = await ctx.runAction(internal.prompts.factExtraction.extractAndPersistFacts, ...);

for (const factId of factIds) {
  await ctx.scheduler.runAfter(0, internal.lib.embedding.embedFact, { factId });
}
```

### 3.8 Estágio 7 — Housekeeping (mutation)

**Função:** `processTurn.finalizeTurn`.

```typescript
export const finalizeTurn = internalMutation({
  args: {
    gmMessageId: v.id("messages"),
    triggersFired: v.array(v.id("triggers")),
    factsRevealed: v.array(v.id("facts")),
    tokensUsed: v.object({ input: v.number(), output: v.number() }),
  },
  handler: async (ctx, args) => {
    const gmMessage = await ctx.db.get(args.gmMessageId);
    if (!gmMessage) throw new Error(`Message not found: ${args.gmMessageId}`);

    await ctx.db.patch(args.gmMessageId, {
      status: "complete",
      finalizedAt: Date.now(),
      triggersFired: args.triggersFired,
      factsRevealed: args.factsRevealed,
      tokensUsed: args.tokensUsed,
    });

    // Atualizar lastActivityAt da campanha
    await ctx.db.patch(gmMessage.campaignId, { lastActivityAt: Date.now() });

    // Avaliar threshold de resumo
    const messageCountInScene = await ctx.db
      .query("messages")
      .withIndex("by_scene_and_createdAt", (q) => q.eq("sceneId", gmMessage.sceneId))
      .collect();

    if (messageCountInScene.length >= SUMMARY_THRESHOLD) {
      // Agendar resumo (Estágio 8)
      await ctx.scheduler.runAfter(0, internal.summaries.summarizeScene, {
        sceneId: gmMessage.sceneId,
      });
    }
  },
});
```

### 3.9 Estágio 8 — Resumos em Background (action)

**Função:** `summaries.summarizeScene` (substituir o stub atual em `scenes.ts`).

```typescript
export const summarizeScene = internalAction({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const scene = await ctx.runQuery(internal.scenes.getById, { sceneId: args.sceneId });
    if (!scene) return;

    // Idempotência: não resumir duas vezes a mesma cena
    const existing = await ctx.runQuery(internal.summaries.findByScene, { sceneId: args.sceneId });
    if (existing) return;

    const messages = await ctx.runQuery(internal.messages.getAllByScene, { sceneId: args.sceneId });

    const campaign = await ctx.runQuery(internal.campaigns.getById, { campaignId: scene.campaignId });
    const prompt = buildSceneSummaryPrompt(scene, messages);

    const summaryContent = await callLlm({
      model: campaign.llmConfig.utilityModel,
      messages: [{ role: "user", content: prompt }],
    });

    const embedding = await generateEmbedding(summaryContent);

    const summaryId = await ctx.runMutation(internal.summaries.create, {
      campaignId: scene.campaignId,
      level: "scene",
      content: summaryContent,
      sourceSceneIds: [args.sceneId],
      sourceMessageIds: messages.map((m) => m._id),
      coversFrom: messages[0].createdAt,
      coversTo: messages[messages.length - 1].createdAt,
      embedding,
    });

    // Avaliar threshold de arc summary
    const sceneSummaries = await ctx.runQuery(internal.summaries.listByCampaignLevel, {
      campaignId: scene.campaignId,
      level: "scene",
    });

    if (sceneSummaries.length % ARC_THRESHOLD === 0) {
      await ctx.scheduler.runAfter(0, internal.summaries.summarizeArc, {
        campaignId: scene.campaignId,
        sourceSummaryIds: sceneSummaries.slice(-ARC_THRESHOLD).map((s) => s._id),
      });
    }
  },
});
```

---

## 4. Padrões de Integração

### 4.1 OpenRouter — Cliente

Centralizar em `convex/lib/llmClient.ts`:

```typescript
export interface LlmCallOptions {
  model: string;
  messages: ChatMessage[];
  tools?: Tool[];
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  forceJsonResponse?: boolean;
}

export async function callLlm(opts: LlmCallOptions, apiKey?: string): Promise<LlmResponse> {
  const key = apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OpenRouter API key not configured");

  const body: any = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.7,
  };

  if (opts.tools) body.tools = opts.tools;
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.forceJsonResponse) body.response_format = { type: "json_object" };
  if (opts.stream) body.stream = true;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://mythwright.app",
      "X-Title": "Mythwright",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter error ${response.status}: ${await response.text()}`);
  }

  if (opts.stream) {
    return parseStreamingResponse(response.body!);
  } else {
    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      toolCalls: data.choices[0].message.tool_calls,
      usage: data.usage,
    };
  }
}
```

**Resolução de chave (BYOK):**

```typescript
export async function getApiKeyForUser(
  ctx: ActionCtx,
  userId: Id<"users">
): Promise<string> {
  const userKey = await ctx.runQuery(internal.users.getOpenRouterKeyInternal, { userId });
  return userKey ?? process.env.OPENROUTER_API_KEY!;
}
```

### 4.2 Streaming de OpenRouter (SSE)

```typescript
async function* parseStreamingResponse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") return;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices[0]?.delta;
        if (delta?.content) yield { type: "text_delta", delta: delta.content };
        if (delta?.tool_calls) yield { type: "tool_call", toolCall: delta.tool_calls[0] };
      } catch (e) {
        // ignorar linhas malformadas
      }
    }
  }
}
```

### 4.3 Embedding Provider

Usar Together AI ou Hugging Face Inference para `bge-m3`. Centralizar em `convex/lib/embedding.ts`:

```typescript
const EMBEDDING_API = "https://api.together.xyz/v1/embeddings";
const EMBEDDING_MODEL = "BAAI/bge-m3";

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch(EMBEDDING_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.TOGETHER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding error: ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}
```

**Para batch embeddings (eficiência):**

```typescript
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  // Together suporta batch via array em input
  const response = await fetch(EMBEDDING_API, {
    method: "POST",
    headers: { /* idem */ },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });
  const data = await response.json();
  return data.data.map((d: any) => d.embedding);
}
```

### 4.4 Vector Search Helper

```typescript
// convex/lib/vectorSearch.ts
import { ActionCtx } from "../_generated/server";

export async function vectorSearch<T extends string>(
  ctx: ActionCtx,
  table: T,
  opts: {
    embedding: number[];
    filters: Record<string, any>;
    k: number;
    indexName?: string;
  }
): Promise<any[]> {
  const indexName = opts.indexName ?? "by_embedding";

  const results = await (ctx as any).vectorSearch(table, indexName, {
    vector: opts.embedding,
    limit: opts.k,
    filter: (q: any) => {
      let chained = q;
      for (const [key, val] of Object.entries(opts.filters)) {
        chained = chained.eq(key, val);
      }
      return chained;
    },
  });

  // Hidratar documentos completos
  const docs = await Promise.all(
    results.map((r: any) => ctx.runQuery(internal[`${table}` as never].getByIdInternal as never, { id: r._id }))
  );

  return docs.filter(Boolean);
}
```

Cada tabela com vectorIndex precisa de uma query interna `getByIdInternal` para hidratação. Convencionar.

---

## 5. Padrão para Compel — Continuação Agendada

Compel é a única tool que pausa o turno. Padrão:

**Fluxo:**

1. GM gera resposta. No meio, chama `compel_aspect`.
2. Tool registra compel pendente, retorna `{ status: "awaiting_player_decision", compelId }`.
3. processTurn detecta o sinal especial e retorna sem completar a resposta. Mensagem GM fica `status: "pending"`.
4. UI cliente, vendo o compel pendente (via subscription em `compels`), mostra modal.
5. Jogador decide. Cliente chama `compels.resolveCompel(compelId, decision)`.
6. `resolveCompel` mutation atualiza compel, ajusta Pontos de Destino, e **agenda continuação**.
7. Action `processTurn.continueAfterCompel(playerMessageId, gmMessageId, compelDecision)` é executada.
8. Continuação monta contexto incluindo o resultado do compel, retoma do Estágio 4 com a mensagem GM já criada (apenas adiciona tokens), e segue normalmente.

**Pseudocódigo da continuação:**

```typescript
export const continueAfterCompel = internalAction({
  args: {
    playerMessageId: v.id("messages"),
    gmMessageId: v.id("messages"),
    compelId: v.id("compels"),
  },
  handler: async (ctx, args) => {
    // Reconstruir contexto
    const context = await buildTurnContext(ctx, args.playerMessageId);
    const compel = await ctx.runQuery(internal.compels.getById, { compelId: args.compelId });

    // Adicionar resultado do compel à mensagem como bloco visual
    await ctx.runMutation(internal.messages.appendToolCall, {
      messageId: args.gmMessageId,
      toolName: "compel_resolution",
      toolParams: { compelId: args.compelId },
      toolResult: { decision: compel.status, fatePointDelta: compel.status === "accepted" ? +1 : -1 },
    });

    // Continuar geração com a mensagem GM existente
    const result = await generateGmResponse(ctx, context, /* triggerResult vazio aqui */, {
      existingMessageId: args.gmMessageId,
      compelDecision: compel.status,
    });

    // Estágios 5-8 normais
    await runValidationAndExtraction(ctx, args.gmMessageId, context);
    await ctx.runMutation(internal.processTurn.finalizeTurn, { ... });
  },
});
```

---

## 6. Tratamento de Erros

### 6.1 Categorias de erro

**Transientes (retry possível):** timeout do OpenRouter, 5xx do provider, network blip. Retry com backoff exponencial até 3x.

**Permanentes (falha definitiva):** 4xx do provider, JSON parse impossível após N tentativas, schema violation. Marcar mensagem como `failed`, expor erro ao cliente.

**Lógicos (prompt issue):** vazamento detectado, tool call malformada. Regenerar conforme política específica.

### 6.2 Padrão de retry

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const max = opts.maxAttempts ?? 3;
  const base = opts.baseDelayMs ?? 500;

  for (let attempt = 0; attempt < max; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isTransient = err.status >= 500 || err.code === "ETIMEDOUT";
      if (!isTransient || attempt === max - 1) throw err;
      await sleep(base * Math.pow(2, attempt));
    }
  }
  throw new Error("unreachable");
}
```

### 6.3 Falha em estágio do turno

Cada estágio que falha deve deixar estado consistente:

- Falha no Estágio 2 (montagem): mensagem do jogador permanece, mensagem GM nunca foi criada. Retry da action funciona.
- Falha no Estágio 3 (gatilhos): efeitos parciais podem ter sido aplicados. Marcar gatilhos disparados, prosseguir mesmo assim para gerar resposta. Tolerância > consistência aqui.
- Falha no Estágio 4 (geração): mensagem GM existe com `status: "pending"` e conteúdo parcial. Marcar como `failed`. Cliente oferece regeneração.
- Falha no Estágio 5 (validação): se a chamada falhar, **não** assumir que vazou. Logar warning, continuar. Aceitar o risco em vez de bloquear o turno.
- Falha no Estágio 6 (extração): logar, mas não falhar o turno. Fatos não persistidos é regressão menor.
- Falha no Estágio 7 (housekeeping): improvável, mas se acontecer, a mensagem fica em estado inconsistente. Job de limpeza periódica detecta `pending` antigos e finaliza.
- Falha no Estágio 8 (resumos): re-tentável independentemente. Não bloqueia turno.

---

## 7. Performance e Custo

### 7.1 Latência por estágio (alvos)

| Estágio | Alvo P50 | Alvo P95 |
|---------|----------|----------|
| 1 (recepção) | 20ms | 50ms |
| 2 (contexto) | 250ms | 500ms |
| 3 (gatilhos) | 600ms | 1000ms |
| 4 (geração, primeiro token) | 1.5s | 3s |
| 4 (geração, completa) | 6s | 12s |
| 5 (validação) | 600ms | 1000ms |
| 6 (extração, paralela a 5) | 800ms | 1500ms |
| 7 (housekeeping) | 50ms | 100ms |
| 8 (resumo, background) | 3s | 8s |

### 7.2 Estratégia de cache

OpenRouter expõe prompt caching para alguns modelos. System prompt + ficha do personagem (relativamente estáticos por turno) são candidatos óbvios. Implementar quando o modelo escolhido suportar. Marcar bloco com `cache_control: { type: "ephemeral" }` no formato Anthropic-compatível, ou equivalente.

### 7.3 Truncamento de histórico

Para campanhas longas, em vez de mandar últimas 20 mensagens cruas, mandar 8 cruas + sumário compacto das anteriores:

```typescript
function buildHistoryWindow(messages: Message[], summaries: Summary[]): ChatMessage[] {
  if (messages.length <= 20) return messages.map(toLlmMessage);

  const recent = messages.slice(-8);
  const olderMessages = messages.slice(0, -8);
  const olderSummary = summarizeMessages(olderMessages); // ou usar sumário pré-existente

  return [
    { role: "system", content: `Contexto anterior comprimido: ${olderSummary}` },
    ...recent.map(toLlmMessage),
  ];
}
```

---

## 8. Estrutura de Diretórios Final

Convex:

```
convex/
├── schema.ts
├── auth.config.ts
├── auth.ts
├── http.ts
│
├── users.ts
├── campaigns.ts
├── characters.ts
├── scenes.ts
├── messages.ts
├── entities.ts
├── facts.ts
├── triggers.ts
├── summaries.ts        ← NOVO
├── diceRolls.ts        ← NOVO
│
├── aspectInvocations.ts
├── compels.ts
├── consequences.ts
├── sceneAspects.ts
├── stress.ts
│
├── processTurn.ts      ← REFATORAR
├── campaignSetup.ts    ← NOVO (geração de mundo + personagem)
│
├── tools/              ← NOVO
│   ├── catalog.ts      (definições JSON Schema das tools)
│   ├── executor.ts     (dispatcher: name → função)
│   ├── rollFateDice.ts
│   ├── invokeAspect.ts
│   ├── compelAspect.ts
│   ├── applyStress.ts
│   ├── applyConsequence.ts
│   ├── awardFatePoint.ts
│   ├── spendFatePoint.ts
│   ├── addSceneAspect.ts
│   ├── changeScene.ts
│   ├── revealFact.ts
│   └── revealEntity.ts
│
├── prompts/
│   ├── gmSystem.ts            ← NOVO
│   ├── triggerClassifier.ts   ← NOVO
│   ├── antiLeak.ts            (existente)
│   ├── factExtraction.ts      (existente)
│   ├── sceneSummary.ts        ← NOVO
│   ├── arcSummary.ts          ← NOVO
│   ├── worldGeneration.ts     ← NOVO
│   └── characterGeneration.ts ← NOVO
│
└── lib/
    ├── auth.ts          (existente)
    ├── crypto.ts        (existente)
    ├── tokenCounter.ts  (existente)
    ├── contextBuilder.ts (existente, ajustar)
    ├── llmClient.ts     ← NOVO
    ├── embedding.ts     ← NOVO
    ├── vectorSearch.ts  ← NOVO
    ├── retry.ts         ← NOVO
    └── types.ts         ← NOVO (TurnContext, etc)
```

Frontend (proposta inicial):

```
src/
├── main.tsx
├── App.tsx
│
├── routes/
│   ├── _layout.tsx
│   ├── index.tsx              (dashboard)
│   ├── login.tsx
│   ├── campaigns.new.tsx      (wizard 4 fases)
│   ├── campaigns.$id.tsx      (jogo)
│   └── campaigns.$id.admin.tsx (cheat mode)
│
├── features/
│   ├── auth/
│   ├── campaign-list/
│   ├── campaign-creation/
│   ├── gameplay/
│   │   ├── ChatPane.tsx
│   │   ├── CharacterSidebar.tsx
│   │   ├── MessageBubble.tsx
│   │   ├── ToolCallBlock.tsx
│   │   ├── DiceRollDisplay.tsx
│   │   ├── CompelModal.tsx
│   │   └── ...
│   └── cheat-mode/
│
├── components/         (componentes genéricos)
├── lib/                (utilitários client)
└── styles/
```

---

## 9. Checklist de implementação por estágio

Para cada estágio, checklist mínima de "pronto":

**Estágio 1:**
- [ ] `messages.sendPlayerMessage` exposta como mutation pública
- [ ] Validação de ownership e status da campanha
- [ ] Idempotência por `clientMessageId`
- [ ] Agendamento de processTurn
- [ ] Atualização de `lastActivityAt`
- [ ] Testes: idempotência, unauth, campanha pausada

**Estágio 2:**
- [ ] `buildTurnContext` puro e testável
- [ ] Embeddings persistidos em mensagens
- [ ] Vector searches paralelas funcionando
- [ ] Testes: contexto montado correto, sem hidden no player_knowledge

**Estágio 3:**
- [ ] `findCandidateTriggers` com pré-filtro + vector top-K
- [ ] `triggers.fireTrigger` aplicando todos os tipos de efeito
- [ ] `classifyTriggers` chamando LLM utilitário
- [ ] Testes: gatilho dispara, efeito aplicado, oneShot funciona

**Estágio 4:**
- [ ] Streaming SSE parseado corretamente
- [ ] Tool calling executado e persistido
- [ ] Compel interrompe corretamente
- [ ] Flush batched de tokens
- [ ] Idempotência (não cria GM message duplicada)
- [ ] Testes: stream simples, com tool, com compel, com erro

**Estágio 5:**
- [ ] Validação opcional via `antiLeakValidationEnabled`
- [ ] Limite de regeneração respeitado
- [ ] Testes: vazamento detectado, regeneração, limite atingido

**Estágio 6:**
- [ ] Extração paralela a 5
- [ ] Embeddings agendados pós-extração
- [ ] Testes: fatos novos persistidos, dedup funciona

**Estágio 7:**
- [ ] Mensagem finalizada com metadados
- [ ] Threshold de resumo avaliado
- [ ] Testes: status correto, threshold dispara

**Estágio 8:**
- [ ] `summarizeScene` implementada
- [ ] `summarizeArc` implementada
- [ ] Idempotência (não resume duas vezes)
- [ ] Testes: resumo gerado, embedding persistido, hierarquia avança

---

**Fim do TAD.**
