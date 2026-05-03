# Mythwright — GAP REPORT

**Data:** Maio 2026
**Baseline:** Estado atual do repositório (`proj.zip`)
**Objetivo:** Listar cada incompletude entre o estado atual e o PRD v1.0, com referência ao código existente e ordem sugerida de implementação para fechar o MVP.

---

## Como ler este documento

Cada gap é classificado em três dimensões.

**Severidade:** `BLOCKER` (impede MVP de funcionar), `HIGH` (impede uma feature do MVP), `MEDIUM` (degrada qualidade ou robustez), `LOW` (polish ou v1+).

**Tipo:** `MISSING` (não existe), `STUB` (existe mas vazio), `INCOMPLETE` (existe parcial), `DIVERGENT` (existe mas contradiz o PRD), `BUG` (existe mas com defeito conhecido).

**Effort:** `XS` (≤2h), `S` (meio dia), `M` (1-2 dias), `L` (3-5 dias), `XL` (semana+).

Cada gap tem ID `G-XXX` para referência cruzada nos outros docs.

---

## 1. BLOCKERS — sem isso o MVP não roda

### G-001 · processTurn é apenas um esqueleto

**Tipo:** `INCOMPLETE` · **Severidade:** `BLOCKER` · **Effort:** `XL`

**Localização:** `convex/processTurn.ts`

**Estado atual:** A função existe e implementa um loop de regeneração com validação anti-vazamento e extração de fatos. Porém, o que está dentro do loop é apenas: chama LLM com `{ role: "user", content: playerMessageContent }` e parseia. Não há montagem de contexto, não há busca em memória, não há resolução de gatilhos, não há tools (exceto detecção hardcoded de `compel_aspect` no JSON parseado), não há streaming, não há mensagem do jogador sendo persistida.

**O que falta para virar os 8 estágios do PRD:**

- Estágio 1 (recepção): mover persistência da mensagem do jogador para dentro do fluxo (hoje espera-se que o cliente já tenha persistido via `messages.createMessage`, mas não há contrato claro).
- Estágio 2 (montagem de contexto): chamar `buildFullContext` (que existe em `lib/contextBuilder.ts`) com dados reais. Hoje o `buildFullContext` não é chamado em lugar nenhum do código de produção.
- Estágio 3 (resolução de gatilhos): não existe. Ver G-007.
- Estágio 4 (geração com tools e streaming): hoje é uma única chamada não-streamada, e a única tool tratada é `compel_aspect`. Ver G-002 e G-003.
- Estágio 5 (validação anti-vazamento): existe e funciona, mas não recebe os fatos hidden filtrados por relevância — o caller passa `hiddenFacts: v.array(...)` como argumento, transferindo a responsabilidade para fora.
- Estágio 6 (extração de fatos): existe e funciona, mas roda dentro do loop de regeneração de forma serial — pelo PRD deveria ser paralela ao 5.
- Estágios 7 e 8 (housekeeping e resumos): não existem.

**Modelo hardcoded:** linha 7, `const GM_MODEL = "openai/gpt-4o-mini"`. Contraria a decisão de open-source. Deve ser configurável por campanha (`campaign.llmConfig.narrativeModel`) que ainda não existe no schema (ver G-019).

---

### G-002 · Streaming inexistente

**Tipo:** `MISSING` · **Severidade:** `BLOCKER` · **Effort:** `L`

**Localização:** `convex/processTurn.ts`, função `callLlm` (linhas 42-56).

**Estado atual:** Chamada única ao OpenRouter sem `stream: true`. Cliente espera resposta completa antes de ver qualquer coisa.

**O que falta:** Implementar fetch com streaming (`stream: true` no body, ler resposta como SSE), e persistência incremental dos tokens via `messages.appendMessageTokens` (que já existe em `convex/messages.ts`). O cliente já recebe via subscription do Convex automaticamente — basta o backend gravar incrementalmente.

**Pegadinha conhecida:** Convex actions têm timeout (atualmente ~10 minutos), e fetch streaming dentro de action funciona, mas exige que o LLM call seja interruptível e que appends sejam batched (a cada N tokens ou N ms) para não saturar mutations.

---

### G-003 · Tool calling real durante geração

**Tipo:** `MISSING` · **Severidade:** `BLOCKER` · **Effort:** `XL`

**Localização:** `convex/processTurn.ts` (esperado), `convex/aspectInvocations.ts`, `convex/sceneAspects.ts`, `convex/stress.ts`, `convex/consequences.ts`, `convex/compels.ts`, `convex/scenes.ts` (todas as tools-alvo já existem como mutations isoladas).

**Estado atual:** Tools FATE existem como mutations chamáveis isoladamente (testadas), mas não há orquestrador que as exponha ao LLM como tool calls e processe os retornos. O processTurn detecta `compel_aspect` no JSON parseado de uma resposta única — não é tool calling de verdade.

**O que falta:**

1. Definir o catálogo de tools no formato OpenRouter (JSON Schema): `roll_fate_dice`, `invoke_aspect`, `compel_aspect`, `apply_stress`, `apply_consequence`, `award_fate_point`, `spend_fate_point`, `add_scene_aspect`, `change_scene`, `reveal_fact`, `reveal_entity`. Ver §8 do PRD.
2. Tool registry em `convex/tools/` que mapeia cada nome de tool para a mutation/action correspondente.
3. Loop de tool calling no processTurn: stream → detectar tool_call → executar → append result → continuar stream.
4. Tool `roll_fate_dice` precisa de um wrapper Convex sobre o `rollFateDice` do fate-engine que persista em `diceRolls` (que está stub — ver G-005).

**Decisão pendente:** se aderência a tool calling em modelos open-source (DeepSeek V3, Llama 3.3) for ruim, plano B com marcadores em texto. Documentado no TAD §3.

---

### G-004 · Sistema de gatilhos não-operacional

**Tipo:** `INCOMPLETE` · **Severidade:** `BLOCKER` · **Effort:** `L`

**Localização:** `convex/triggers.ts`, `packages/fate-engine/src/index.ts` (`filterTriggerCandidates`).

**Estado atual:** Há CRUD de triggers e função `resolveTriggerEffects`. O `fate-engine` tem `filterTriggerCandidates` que faz pré-filtro por escopo. Não há fase de classificação por LLM, não há embedding, não há integração com `processTurn` (Estágio 3).

**O que falta:**

1. Embeddings em `triggers.embedding` (ver G-008 — schema e G-009 — pipeline de embedding).
2. Vector index em triggers.
3. Action `classifyTriggers(playerMessage, candidates)` que chama LLM utilitário, recebe top-K já filtrados, retorna IDs ativados.
4. Integração no Estágio 3 do processTurn: pré-filtro determinístico → top-K vetorial → classificação → executar `resolveTriggerEffects` para cada disparado.
5. Schema de triggers precisa de `oneShot` (boolean), `firedByMessageId`, e `scopeRefId` separado de `scope` (ver G-019).

---

### G-005 · diceRolls e summaries são stubs vazios

**Tipo:** `STUB` · **Severidade:** `BLOCKER` · **Effort:** `S`

**Localização:** `convex/schema.ts` linhas 113-119.

**Estado atual:**
```typescript
summaries: defineTable({ campaignId: v.id("campaigns") }).index("by_campaign", ["campaignId"]),
diceRolls: defineTable({ campaignId: v.id("campaigns") }).index("by_campaign", ["campaignId"]),
```

Sem campos de domínio. Impossível persistir rolagens auditáveis ou sumários hierárquicos.

**O que falta:** Schema completo conforme PRD §5.4. Detalhado em G-019.

---

### G-006 · Frontend é template Vite

**Tipo:** `MISSING` · **Severidade:** `BLOCKER` · **Effort:** `XL`

**Localização:** `src/App.tsx`.

**Estado atual:** Hello World do Vite com contador. Zero rotas, zero auth client, zero componentes de produto.

**O que falta:**
- Convex client provider e auth provider configurado.
- Roteamento (React Router): `/`, `/login`, `/dashboard`, `/campaigns/new`, `/campaigns/:id`, `/campaigns/:id/admin`.
- Componentes core listados no PRD §7 (`MessageBubble`, `ToolCallBlock`, `AspectChip`, `FatePointCounter`, `StressTrack`, `ConsequenceCard`, etc).
- Design system mínimo (paleta, tipografia, base).
- Telas: dashboard, criação 4 fases, jogo, cheat mode.

Effort XL porque é o produto inteiro do lado cliente. Pode ser fragmentado em incrementos sucessivos.

---

### G-007 · Sem auth provider configurado

**Tipo:** `MISSING` · **Severidade:** `BLOCKER` · **Effort:** `M`

**Localização esperada:** `convex/auth.config.ts`, `convex/auth.ts`, `src/main.tsx`.

**Estado atual:** `lib/auth.ts` tem `getAuthenticatedUser` que assume que `ctx.auth.getUserIdentity()` já está configurado, e `users.upsertFromAuth` espera receber `displayName` e `avatar`. Nenhum provider está configurado. Não há `auth.config.ts`, não há `@convex-dev/auth` instalado, não há ConvexAuthProvider no cliente.

**O que falta:**
- Decidir provedor: Convex Auth nativo (recomendado pelo PRD) com email/senha + Google opcional.
- Instalar `@convex-dev/auth`, configurar `auth.config.ts`, criar `auth.ts` com providers.
- `ConvexAuthProvider` no cliente, fluxo de login/registro.

---

## 2. HIGH — impede features importantes do MVP

### G-008 · Schema sem vectorIndex e sem campos de embedding

**Tipo:** `MISSING` · **Severidade:** `HIGH` · **Effort:** `M`

**Localização:** `convex/schema.ts`.

**Estado atual:** Nenhuma tabela tem `vectorIndex`. Nenhum campo `embedding`.

**O que falta:** Adicionar campo `embedding: v.optional(v.array(v.float64()))` e `.vectorIndex(...)` em `messages`, `entities`, `facts`, `triggers`, `summaries`. Dimensão 1024 (modelo `bge-m3`). Filterfields apropriados (ver G-019 para schema completo).

**Bloqueia:** G-004 (gatilhos), G-009 (memória semântica), G-013 (resumos hierárquicos).

---

### G-009 · Pipeline de embedding inexistente

**Tipo:** `MISSING` · **Severidade:** `HIGH` · **Effort:** `M`

**Localização esperada:** `convex/lib/embedding.ts`, integração em `processTurn`, e em mutations de criação/edição de entities/facts/triggers/messages.

**Estado atual:** Nada. Nenhuma chamada a API de embedding existe.

**O que falta:**
- Action utilitária `generateEmbedding(text)` que chama provider de embedding (OpenRouter ou Together AI hospedando `bge-m3`).
- Hooks de geração: ao criar/editar fato/entidade/gatilho, embedding é gerado. Pode ser via internal mutation que agenda action de embedding (atualização posterior do registro).
- Embedding da mensagem do jogador no Estágio 2 do processTurn.
- Função `vectorSearch(table, embedding, filters, k)` envolvendo `ctx.vectorSearch`.

**Pegadinha:** Convex `ctx.vectorSearch` só existe em actions, não em queries/mutations. Significa que toda busca semântica precisa ser feita em action, com queries auxiliares para hidratar os documentos.

---

### G-010 · Geração de mundo (Fase 2 da criação) inexistente

**Tipo:** `MISSING` · **Severidade:** `HIGH` · **Effort:** `L`

**Localização esperada:** `convex/prompts/worldGeneration.ts`, `convex/campaignSetup.ts`.

**Estado atual:** `campaigns.createCampaign` só persiste premise/tone/duration. Não há geração de NPCs, fatos, gatilhos, cena inicial.

**O que falta:**
- Prompt de geração de mundo (ver Prompt Library).
- Action que recebe `campaignId`, monta prompt, chama LLM narrativo, parseia JSON estruturado, persiste tudo (entidades, fatos, gatilhos, cena inicial) numa transação lógica.
- Estado intermediário: `status: "setup"` com sub-fases para permitir retomada (campos novos no schema, ver G-019).
- Wizard frontend correspondente (parte de G-006).

---

### G-011 · System prompt do GM inexistente

**Tipo:** `MISSING` · **Severidade:** `HIGH` · **Effort:** `M`

**Localização esperada:** `convex/prompts/gmSystemPrompt.ts`.

**Estado atual:** `processTurn.callLlm` envia mensagem do jogador como única mensagem, sem system prompt. O `buildFullContext` em `lib/contextBuilder.ts` constrói blocos de contexto mas usa `campaign.systemPrompt ?? ""` como system — esse campo nem existe no schema de campaigns.

**O que falta:** Template de system prompt do GM completo conforme PRD §9.2 (identidade, princípios narrativos, regras FATE compactas, instrução de tools, tom, premissa). Função `buildGmSystemPrompt(campaign)` que injeta `tone` e `premise`. Documentado na Prompt Library.

---

### G-012 · Sem fluxo de criação de personagem assistido

**Tipo:** `MISSING` · **Severidade:** `HIGH` · **Effort:** `M`

**Localização esperada:** `convex/prompts/characterGeneration.ts`, integração com `campaignSetup`.

**Estado atual:** `characters.createCharacter` aceita ficha já preenchida. Não há geração assistida.

**O que falta:** Prompt de geração de personagem (parte da Prompt Library), action que gera ficha FATE a partir de premissa textual, wizard de edição manual alternativo (5 fases canônicas FATE).

---

### G-013 · Resumos hierárquicos não implementados

**Tipo:** `STUB` · **Severidade:** `HIGH` · **Effort:** `L`

**Localização:** `convex/scenes.ts` linhas 53-60 (`summarizeScene` retorna `null`).

**Estado atual:** Stub vazio. `changeScene` agenda chamada a esse stub, então nada acontece.

**O que falta:**
- Implementar `summarizeScene` como action: lê mensagens da cena, chama LLM utilitário com prompt de resumo, persiste em `summaries` com `level: "scene"`, gera embedding.
- Job análogo `summarizeArc` agendado a cada N cenas.
- Schema de summaries completo (ver G-019).
- Prompt de resumo (ver Prompt Library).

---

### G-014 · Sem orquestração de "compel pendente" robusta

**Tipo:** `INCOMPLETE` · **Severidade:** `HIGH` · **Effort:** `M`

**Localização:** `convex/processTurn.ts` linhas 110-124, `convex/compels.ts`.

**Estado atual:** O `processTurn` detecta `compel_aspect`, persiste o compel como pending, retorna `awaiting_player_decision`. Bom até aqui. Mas não há mecanismo para o turno **continuar** após o jogador resolver o compel via `compels.resolveCompel`. O fluxo atual encerra a action e nunca retoma.

**O que falta:** Padrão de continuação. Duas alternativas no TAD:

1. **Continuação agendada:** quando o jogador resolve o compel, `resolveCompel` agenda uma nova action `continueAfterCompel(messageId)` que monta contexto incluindo o resultado do compel e gera o resto da resposta.
2. **Compel síncrono via long-polling:** action espera até X segundos pela resolução e segue. Pior, não escala.

Recomendação: continuação agendada.

---

### G-015 · Modelo LLM hardcoded

**Tipo:** `DIVERGENT` · **Severidade:** `HIGH` · **Effort:** `S`

**Localização:** `convex/processTurn.ts` linha 7, `convex/prompts/antiLeak.ts` linha 6, `convex/prompts/factExtraction.ts` linha 7.

**Estado atual:** Todas as três usam `openai/gpt-4o-mini`, modelo proprietário. PRD especifica DeepSeek V3 para narrativa, Llama 3.1 8B para tarefas utilitárias.

**O que falta:**
- Schema: `campaigns.llmConfig` com `narrativeModel`, `utilityModel`, `extractionModel`, `embeddingModel` (ver G-019).
- Helper `getLlmConfig(campaignId)` que lê do registro.
- Substituir constantes hardcoded por leitura do config.
- Validar no MVP que os modelos open-source funcionam aceitavelmente. Se não, fallback para BYOK proprietário documentado.

---

### G-016 · Visibility de entities sem `rumored`

**Tipo:** `DIVERGENT` · **Severidade:** `HIGH` · **Effort:** `S`

**Localização:** `convex/schema.ts` linha 90.

**Estado atual:** `entities.visibility: v.union(v.literal("hidden"), v.literal("known"))`. Faltando `rumored`.

**Problema:** Inconsistente com `facts.visibility` (que tem os 3) e com PRD. Limita a expressividade do estado intermediário "ouviu falar mas não conhece".

**O que falta:** Migrar para `v.union(v.literal("hidden"), v.literal("rumored"), v.literal("known"))` e atualizar todas as consumidoras (testes, contextBuilder, listEntities, etc).

---

### G-017 · contextBuilder não é chamado em produção

**Tipo:** `INCOMPLETE` · **Severidade:** `HIGH` · **Effort:** `S` (uma vez que o processTurn for refatorado)

**Localização:** `convex/lib/contextBuilder.ts`.

**Estado atual:** Funções `buildSceneBlock`, `buildWorldStateBlock`, `buildMessageWindow`, `buildFullContext`, `buildCharacterBlock` existem e são testadas (`contextBuilder.test.ts`, 431 linhas). Nenhuma é chamada em código de produção. `processTurn` envia só a mensagem do jogador crua.

**O que falta:** Integrar no Estágio 2 do processTurn refatorado.

**Adicional:** O `buildFullContext` recebe `entities` como `[]` em todas as chamadas (linhas 138, 141 do contextBuilder). Falta passar entidades reais. E o `campaign.systemPrompt` esperado não existe no schema (ver G-011).

---

### G-018 · Idempotência incompleta

**Tipo:** `INCOMPLETE` · **Severidade:** `HIGH` · **Effort:** `S`

**Localização:** `convex/messages.ts` (`createMessage`), `convex/processTurn.ts`.

**Estado atual:** `createMessage` deduplica por `clientMessageId` (bom). Mas `processTurn` não checa se já houve resposta para essa mensagem do jogador antes de gerar nova — se a action for re-agendada por qualquer razão, gera múltiplas respostas do GM.

**O que falta:** Guard no início do processTurn que checa se já existe mensagem GM com `causedBy: playerMessageId` (campo a adicionar em messages, ver G-019). Ou flag idempotente baseado em `clientMessageId` da mensagem do jogador.

---

## 3. MEDIUM — robustez e qualidade

### G-019 · Schema precisa de campos faltantes

**Tipo:** `INCOMPLETE` · **Severidade:** `MEDIUM` (mas bloqueia vários `HIGH`) · **Effort:** `M`

**Localização:** `convex/schema.ts`.

**Itens específicos:**

`campaigns`:
- `llmConfig: v.object({ narrativeModel, utilityModel, extractionModel, embeddingModel })` — bloqueia G-015.
- `currentSceneId: v.optional(v.id("scenes"))` — denormalização útil para reads rápidos.

`messages`:
- `embedding: v.optional(v.array(v.float64()))` + vectorIndex — bloqueia G-009.
- `causedByMessageId: v.optional(v.id("messages"))` — para idempotência (G-018).
- `triggersFired: v.optional(v.array(v.id("triggers")))` — auditoria.
- `factsRevealed: v.optional(v.array(v.id("facts")))` — auditoria.

`entities`:
- `embedding` + vectorIndex — bloqueia G-009.
- `visibility` com `rumored` — bloqueia G-016.
- `relations: v.array(...)` — relações entre entidades (PRD §5.4). Pode ser MVP-late.
- `npcStats: v.optional(...)` — stats FATE de NPCs com tier (PRD §5.4). MVP-late.

`facts`:
- `embedding` + vectorIndex — bloqueia G-009.
- `revealedBy: v.optional(v.object({ messageId, triggerId, revealedAt }))` — auditoria.
- `category: v.optional(v.string())` — organização.

`triggers`:
- `embedding` + vectorIndex — bloqueia G-009 e G-004.
- `oneShot: v.boolean()` — semântica de gatilho recorrente vs único.
- `firedByMessageId: v.optional(v.id("messages"))` — auditoria.
- `scopeRefId: v.optional(v.string())` — separar tipo de escopo do alvo.

`summaries`:
- Reescrever do zero conforme PRD §5.4: `level`, `content`, `sourceMessageIds`, `sourceSceneIds`, `sourceSummaryIds`, `coversFrom`, `coversTo`, `embedding` + vectorIndex.

`diceRolls`:
- Reescrever do zero conforme PRD §5.4: `messageId`, `type`, `skillName`, `skillLevel`, `invokedAspects`, `bonus`, `diceResults`, `diceTotal`, `finalResult`, `description`, `opposition`, `outcome`, `seed`.

**Migração:** ver Schema Migration Plan.

---

### G-020 · Sumários e diceRolls sem testes (porque vazios)

**Tipo:** `MISSING` · **Severidade:** `MEDIUM` · **Effort:** `S` (pareado com implementação)

**Localização:** `convex/`. Não há `summaries.ts`, não há `diceRolls.ts`, e portanto não há testes.

**O que falta:** Implementar e testar simultaneamente após G-019.

---

### G-021 · Prompts utilitários não usam modelo configurável

**Tipo:** `DIVERGENT` · **Severidade:** `MEDIUM` · **Effort:** `XS`

**Localização:** `convex/prompts/antiLeak.ts`, `convex/prompts/factExtraction.ts`.

Já capturado em G-015 (modelo hardcoded). Listo separadamente porque pode ser corrigido em PR isolado.

---

### G-022 · Sem rate limiting / quota por usuário

**Tipo:** `MISSING` · **Severidade:** `MEDIUM` · **Effort:** `M`

**Localização esperada:** `convex/lib/quotas.ts`, integração em processTurn.

**Estado atual:** Sem controle. Usuário pode disparar quantos turnos quiser, custando OpenRouter para o sistema.

**O que falta:** Quota por usuário (turnos/dia para plano gratuito, ilimitado para BYOK), tracking de uso em tabela `usage`.

**MVP-late:** se BYOK for o único modo no MVP (sem chave do sistema), gap deixa de ser MEDIUM e vira LOW.

---

### G-023 · Sem registro de uso de tokens

**Tipo:** `MISSING` · **Severidade:** `MEDIUM` · **Effort:** `S`

**Localização esperada:** Schema `messages.tokensUsed`, captura em processTurn.

**Estado atual:** Nenhum tracking. PRD prevê `tokensUsed: { input, output }` em messages.

**O que falta:** Adicionar campo no schema, parsear `usage` da resposta OpenRouter, persistir.

---

### G-024 · Validação anti-vazamento sem filtro de relevância de hidden facts

**Tipo:** `INCOMPLETE` · **Severidade:** `MEDIUM` · **Effort:** `S`

**Localização:** `convex/processTurn.ts`, `convex/prompts/antiLeak.ts`.

**Estado atual:** O caller passa `hiddenFacts` como argumento. Lista pode ser arbitrária. No fluxo real do MVP, deveriam ser apenas os fatos hidden relevantes ao contexto da cena (filtrados por proximidade vetorial ou por entidades presentes).

**O que falta:** Estágio 2 do processTurn refatorado deve recuperar hidden facts relevantes (top-K via vectorSearch + presentes na cena via filtros), e passar para o estágio 5.

---

### G-025 · Tests do processTurn não cobrem fluxo completo

**Tipo:** `INCOMPLETE` · **Severidade:** `MEDIUM` · **Effort:** `M` (após refactor do processTurn)

**Localização:** `convex/processTurn.test.ts`.

**Estado atual:** 513 linhas testando o esqueleto atual. Bom para o que existe, mas o que existe não é o que precisa existir.

**O que falta:** Suite completa cobrindo os 8 estágios. Mocks para LLM (OpenRouter) e embedding. Casos de erro (falha em cada estágio, regeneração, vazamento, idempotência). Refazer após G-001.

---

## 4. LOW — polish, v1+, ou bonito-de-ter

### G-026 · `users.list` exposto sem necessidade

**Tipo:** `BUG` (segurança) · **Severidade:** `LOW` · **Effort:** `XS`

**Localização:** `convex/users.ts` linhas 88-95.

**Estado atual:** Query pública que lista até 100 usuários. Provavelmente código de scaffold/teste deixado no repo.

**O que falta:** Remover ou restringir a admin futuro.

---

### G-027 · Frontend ainda mostra logos do Vite

**Tipo:** `MISSING` · **Severidade:** `LOW` · **Effort:** `XS`

**Localização:** `src/App.tsx`, `src/assets/`.

Já capturado em G-006.

---

### G-028 · `eslint-plugin-react-hooks` em devDeps mas não configurado

**Tipo:** `INCOMPLETE` · **Severidade:** `LOW` · **Effort:** `XS`

**Localização:** `eslint.config.js`.

Apenas higiene de projeto. Não bloqueia nada.

---

### G-029 · Sem CI/CD

**Tipo:** `MISSING` · **Severidade:** `LOW` (para MVP solo) · **Effort:** `S`

**Localização esperada:** `.github/workflows/`.

**Estado atual:** Nenhum workflow. Considerando que o autor já tem expertise em CI/CD do Inbot, pode ser quick-win em algum momento.

---

### G-030 · Sem observability

**Tipo:** `MISSING` · **Severidade:** `LOW` (para MVP) · **Effort:** `M`

Sem logs estruturados, sem métricas, sem alertas. PRD §11 lista métricas-alvo. Para MVP, console.log + dashboard do OpenRouter é aceitável. v1 precisa de algo melhor.

---

## 5. Ordem sugerida de implementação

Os gaps acima formam uma rede de dependências. A ordem abaixo respeita dependências e prioriza desbloquear o "loop de jogo" o quanto antes para validar a tese central do produto. Sprints de ~1 semana cada, ajustáveis.

### Sprint 0 — Fundação (1 semana)

Objetivo: destrancar tudo que vem depois.

1. **G-019** — Schema completo. Adicionar campos faltantes e migrar visibilidade de entities. Atualizar testes existentes que dependem dos campos novos. *Critério de saída:* `npm test` passa, schema deployado em dev.
2. **G-007** — Auth provider. Convex Auth com email/senha + Google. *Critério de saída:* fluxo completo de login funciona em dev.
3. **G-015** — Mover modelos hardcoded para `campaign.llmConfig`. Configurar defaults open-source. *Critério de saída:* nenhum modelo proprietário hardcoded no código.
4. **G-026, G-028** — Quick wins de higiene.

### Sprint 1 — Memória semântica e gatilhos (1-2 semanas)

Objetivo: implementar o coração do diferencial técnico.

5. **G-009** — Pipeline de embedding. `lib/embedding.ts`, hooks de geração em criação/edição.
6. **G-008** — vectorIndex já incluso em G-019, mas validar funcionamento real com `ctx.vectorSearch`.
7. **G-005** + **G-020** (parcial) — Reescrever schemas de summaries e diceRolls (parte de G-019 também).
8. **G-004** — Sistema de gatilhos com classificação por LLM.
9. **G-013** — Resumos hierárquicos (scene → arc → campaign).

### Sprint 2 — Loop de jogo (2 semanas)

Objetivo: processTurn de verdade.

10. **G-011** — System prompt do GM versionado.
11. **G-001** — Refatorar processTurn nos 8 estágios. Integra G-017 (chamar contextBuilder), G-024 (filtrar hidden facts), G-018 (idempotência).
12. **G-002** — Streaming.
13. **G-003** — Tool calling real para todas as tools FATE. Wrapper `roll_fate_dice` que persiste em diceRolls.
14. **G-014** — Continuação agendada para compel.
15. **G-023** — Tracking de tokens.
16. **G-025** — Testes completos do processTurn.

### Sprint 3 — Criação de campanha (1 semana)

Objetivo: jogador consegue criar campanha do zero até começar a jogar.

17. **G-010** — Geração de mundo (Fase 2).
18. **G-012** — Geração assistida de personagem (Fase 3).

### Sprint 4 — Frontend MVP (2-3 semanas)

Objetivo: UI do produto inteiro.

19. **G-006** — Frontend completo. Sub-quebra:
    - 19a — Setup: Convex client, auth, roteamento, design system mínimo. (3 dias)
    - 19b — Dashboard de campanhas. (1 dia)
    - 19c — Wizard de criação 4 fases. (3 dias)
    - 19d — Tela de jogo (chat + ficha + tools). (5 dias)
    - 19e — Cheat mode. (2 dias)

### Sprint 5 — Validação e polimento (1 semana)

Objetivo: 3 campanhas de teste end-to-end, ajustes.

20. **G-022, G-029, G-030** — Quotas básicas (se sair do BYOK-only), CI/CD, logs estruturados.
21. Testes de aceitação: 1 one-shot, 1 medium parcial, 1 com 30+ turnos.
22. Iteração em prompts conforme observação.

**Total estimado:** 8-10 semanas para MVP, alinhado com o roadmap do PRD §10.1.

---

## 6. Resumo executivo

**Backend Convex:** 60% pronto. Mecânicas FATE e CRUDs estão sólidos. processTurn é esqueleto, gatilhos não-operacionais, sem memória semântica, sem streaming.

**Schema:** 70% pronto. Faltam campos críticos (embeddings, llmConfig, summaries/diceRolls completos) e ajustes de visibility.

**Prompts:** 30% prontos. AntiLeak e factExtraction OK. System prompt do GM, geração de mundo, geração de personagem, classificação de gatilhos, resumo de cena: todos faltando.

**Tools FATE:** 70% prontas como mutations isoladas. 0% integradas como tool calling real.

**Frontend:** 0%. Template Vite vazio.

**Auth:** 10%. Helper existe, provider não.

**Total para MVP:** ~8-10 semanas de trabalho concentrado, distribuído nos 6 sprints acima.

---

**Fim do GAP REPORT.**
