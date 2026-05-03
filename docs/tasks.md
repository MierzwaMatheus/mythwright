# Mythwright — Backend Tasks até MVP

Cada `[ ]` é uma task pendente. `[x]` = concluída.  
Referências a `@docs/` indicam onde buscar contexto antes de implementar.

---

## Fase 0 — Fundação (desbloqueia tudo)

### Schema — G-019

> Contexto: `@docs/04-schema-migration-plan.md` §2 (schema-alvo completo) e `@docs/01-gap-report.md` G-019

- [x] Adicionar `llmConfig: v.object({ narrativeModel, utilityModel, extractionModel, embeddingModel })` em `campaigns`
- [x] Adicionar `currentSceneId: v.optional(v.id("scenes"))` em `campaigns`
- [x] Adicionar `embedding: v.optional(v.array(v.float64()))` + `vectorIndex("by_embedding", "embedding", { filterFields: ["campaignId", "sceneId", "role"] })` em `messages`
- [x] Adicionar `causedByMessageId: v.optional(v.id("messages"))` em `messages`
- [x] Adicionar `triggersFired: v.optional(v.array(v.id("triggers")))` em `messages`
- [x] Adicionar `factsRevealed: v.optional(v.array(v.id("facts")))` em `messages`
- [x] Adicionar `tokensUsed: v.optional(v.object({ input: v.number(), output: v.number() }))` em `messages`
- [x] Adicionar `"rumored"` ao union de `entities.visibility` (hoje só `hidden | known`)
- [x] Adicionar `embedding: v.optional(v.array(v.float64()))` + `vectorIndex` em `entities`
- [x] Adicionar `embedding: v.optional(v.array(v.float64()))` + `vectorIndex` em `facts`
- [x] Adicionar `revealedBy: v.optional(v.object({ messageId: v.id("messages"), triggerId: v.optional(v.id("triggers")), revealedAt: v.number() }))` em `facts`
- [x] Adicionar `category: v.optional(v.string())` em `facts`
- [x] Adicionar `embedding: v.optional(v.array(v.float64()))` + `vectorIndex` em `triggers`
- [x] Adicionar `oneShot: v.boolean()` em `triggers`
- [x] Adicionar `firedByMessageId: v.optional(v.id("messages"))` em `triggers`
- [x] Adicionar `scopeRefId: v.optional(v.string())` em `triggers`
- [x] Reescrever `summaries` do zero: `level`, `content`, `sourceMessageIds`, `sourceSceneIds`, `sourceSummaryIds`, `coversFrom`, `coversTo`, `embedding` + `vectorIndex`
- [x] Reescrever `diceRolls` do zero: `messageId`, `type`, `skillName`, `skillLevel`, `invokedAspects`, `bonus`, `diceResults`, `diceTotal`, `finalResult`, `description`, `opposition`, `outcome`, `seed`
- [x] Atualizar todos os testes existentes que dependem de `entities.visibility` sem `rumored`
- [x] Verificar que `npm test` passa com schema novo

### Modelos LLM — G-015

> Contexto: `@docs/01-gap-report.md` G-015

- [x] Criar `convex/lib/llmConfig.ts` com `getLlmConfig(ctx, campaignId)` que lê `campaign.llmConfig` e aplica defaults open-source
- [x] Substituir constante hardcoded em `convex/processTurn.ts:7` pelo helper
- [x] Substituir constante hardcoded em `convex/prompts/antiLeak.ts:6` pelo helper
- [x] Substituir constante hardcoded em `convex/prompts/factExtraction.ts:7` pelo helper
- [x] Testar que `getLlmConfig` retorna defaults quando `llmConfig` ausente
- [x] Testar que `getLlmConfig` respeita override por campanha

### Higiene — G-026

- [x] Remover ou restringir a admin a query `users.list` em `convex/users.ts:88-95`

---

## Fase 1 — Memória Semântica

### Pipeline de Embedding — G-009

> Contexto: `@docs/02-technical-architecture.md` §5 (embedding e vector search) e `@docs/01-gap-report.md` G-009

- [x] Criar `convex/lib/embedding.ts` com `internalAction generateEmbedding(text: string): number[]` chamando `bge-m3` via OpenRouter/Together AI
- [x] Criar wrapper `vectorSearch(ctx, table, queryEmbedding, filters, k)` usando `ctx.vectorSearch` (só funciona em actions)
- [x] Ao criar `fact`: agendar action que preenche `facts.embedding`
- [x] Ao editar `fact`: regenerar embedding
- [x] Ao criar `entity`: agendar action que preenche `entities.embedding`
- [x] Ao criar `trigger`: agendar action que preenche `triggers.embedding`
- [x] Testar `generateEmbedding` com mock do provider (deve retornar array de 1024 floats)
- [x] Testar que hook de criação de fact dispara e persiste embedding

### Gatilhos Operacionais — G-004

> Contexto: `@docs/02-technical-architecture.md` §6.3 (Estágio 3 — resolução de gatilhos) e `@docs/01-gap-report.md` G-004

- [x] Criar `convex/prompts/triggerClassifier.ts` com `buildTriggerClassifierPrompt(playerMessage, candidates)` e parser de resposta — consultar `@docs/03-prompt-library.md` §2
- [x] Criar `convex/actions/classifyTriggers.ts` com `internalAction classifyTriggers(playerMessage, candidates)` que chama LLM utilitário e retorna IDs de gatilhos ativados
- [x] Testar `classifyTriggers` com mock de LLM para cenários de ativação e não-ativação
- [x] Testar integração com `filterTriggerCandidates` do `fate-engine` (já existe em `packages/fate-engine`)

### Resumos Hierárquicos — G-013

> Contexto: `@docs/03-prompt-library.md` §5 (Scene Summarizer) e §6 (Arc Summarizer) e `@docs/01-gap-report.md` G-013

- [x] Criar `convex/prompts/sceneSummarizer.ts` com template e parser conforme Prompt Library §5
- [x] Implementar `summarizeScene(sceneId)` em `convex/scenes.ts` (hoje stub na linha 53): lê mensagens, chama LLM utilitário, persiste em `summaries` com `level: "scene"`, gera embedding
- [x] Criar `convex/prompts/arcSummarizer.ts` conforme Prompt Library §6
- [x] Implementar `internalAction summarizeArc(campaignId)` que agrega sumários de cena em sumário de arco
- [x] Testar que `summarizeScene` persiste corretamente em `summaries` com todos os campos
- [x] Testar que `summarizeArc` agrega múltiplos sumários de cena

---

## Fase 2 — Loop de Jogo Completo

### System Prompt do GM — G-011

> Contexto: `@docs/03-prompt-library.md` §1 (GM System Prompt) e `@docs/01-gap-report.md` G-011

- [x] Criar `convex/prompts/gmSystemPrompt.ts` com `buildGmSystemPrompt(campaign)` injetando `tone`, `premise`, regras FATE compactas e instrução de tools
- [x] Testar que o prompt gerado inclui os campos da campanha e a versão do prompt

### Streaming — G-002

> Contexto: `@docs/02-technical-architecture.md` §3.4 (Estágio 4 — geração com streaming) e `@docs/01-gap-report.md` G-002

- [x] Implementar fetch com `stream: true` e leitura de SSE em `convex/processTurn.ts`
- [x] Persistir tokens incrementalmente via `messages.appendMessageTokens` (já existe em `convex/messages.ts`) a cada batch de N tokens ou N ms
- [x] Testar streaming com mock de SSE — verificar que tokens chegam na order correta em `messages`

### Tool Calling Real — G-003

> Contexto: `@docs/02-technical-architecture.md` §8 (catálogo de tools FATE) e `@docs/01-gap-report.md` G-003

- [x] Criar `convex/tools/registry.ts` mapeando cada tool FATE para a mutation/action correspondente
- [x] Definir JSON Schema (OpenRouter format) para cada tool: `roll_fate_dice`, `invoke_aspect`, `compel_aspect`, `apply_stress`, `apply_consequence`, `award_fate_point`, `spend_fate_point`, `add_scene_aspect`, `change_scene`, `reveal_fact`, `reveal_entity`
- [x] Implementar loop de tool calling em `processTurn`: stream → detectar `tool_call` → executar via registry → append result → continuar stream
- [x] Criar wrapper `roll_fate_dice` que chama `rollFateDice` do fate-engine e persiste resultado em `diceRolls`
- [x] Testar loop completo de tool calling com mock de stream contendo tool_calls
- [x] Testar cada tool individualmente via registry

### processTurn — 8 Estágios Completos — G-001

> Contexto: `@docs/02-technical-architecture.md` §3 (pseudocódigo completo dos 8 estágios) e `@docs/01-gap-report.md` G-001, G-017, G-018, G-024, G-025

- [x] **Estágio 1:** garantir persistência da mensagem do jogador com contrato claro (idempotência por `clientMessageId`)
- [x] **Idempotência:** guard no início verificando se já existe mensagem GM com `causedByMessageId == playerMessageId` — se sim, retornar sem reprocessar (G-018)
- [x] **Estágio 2:** integrar `buildFullContext` de `convex/lib/contextBuilder.ts` com dados reais (entidades, cena, histórico de mensagens, sumários); gerar embedding da mensagem do jogador
- [x] **Estágio 3:** integrar `classifyTriggers` + `resolveTriggerEffects` (pré-filtro determinístico → vectorSearch top-K → classify → executar)
- [x] **Estágio 4:** substituir chamada única por loop de streaming + tool calling (usa G-002 e G-003)
- [x] **Estágio 5:** buscar hidden facts relevantes via vectorSearch antes de passar para `validateAntiLeak` (em vez de receber lista arbitrária do caller) (G-024)
- [x] **Estágio 6:** confirmar que `extractAndPersistFacts` roda em paralelo com estágio 5 (já implementado, revisar se é paralelo)
- [x] **Estágio 7:** housekeeping — persistir `triggersFired` e `factsRevealed` na mensagem GM; persistir `tokensUsed` da resposta
- [x] **Estágio 8:** ao detectar mudança de cena, agendar `summarizeScene` da cena encerrada
- [x] Usar `buildGmSystemPrompt` (G-011) no contexto enviado ao LLM
- [x] Suite de testes completa dos 8 estágios com mocks de LLM e embedding (G-025)
- [x] Testar idempotência: action re-agendada não gera resposta duplicada
- [x] Testar regeneração por vazamento: anti-leak falha → regenera com memória do turno

### Continuação Pós-Compel — G-014

> Contexto: `@docs/02-technical-architecture.md` §6.5 (orquestração de compel) e `@docs/01-gap-report.md` G-014

- [ ] Implementar `internalAction continueAfterCompel(playerMessageId)` que monta contexto com resultado do compel e retoma geração
- [ ] Modificar `compels.resolveCompel` para agendar `continueAfterCompel` após persistir a resolução
- [ ] Testar fluxo completo: compel detectado → `awaiting_player_decision` → jogador resolve → continuação gera resto da resposta

---

## Fase 3 — Criação de Campanha por IA

### Geração de Mundo — G-010

> Contexto: `@docs/03-prompt-library.md` §7 (World Generator) e `@docs/01-gap-report.md` G-010

- [ ] Criar `convex/prompts/worldGeneration.ts` com template e parser conforme Prompt Library §7
- [ ] Criar `convex/actions/generateWorld.ts` com `internalAction generateWorld(campaignId)`: chama LLM narrativo, parseia JSON, persiste entidades, fatos, gatilhos e cena inicial
- [ ] Adicionar campo `status` em `campaigns` para sub-fases de setup (`"draft" | "generating" | "ready"`)
- [ ] Testar geração de mundo com mock de LLM — verificar que entidades, fatos e gatilhos são persistidos corretamente
- [ ] Testar que falha no LLM não deixa campanha em estado inconsistente

### Geração Assistida de Personagem — G-012

> Contexto: `@docs/03-prompt-library.md` §8 (Character Generator) e `@docs/01-gap-report.md` G-012

- [ ] Criar `convex/prompts/characterGeneration.ts` com template e parser conforme Prompt Library §8
- [ ] Criar `convex/actions/generateCharacter.ts` com `internalAction generateCharacter(campaignId, premise)`: gera ficha FATE completa a partir de texto livre
- [ ] Testar geração de personagem com mock de LLM — verificar campos obrigatórios da ficha FATE (aspects, skills, stress tracks)

---

## Critério de MVP Backend Completo

Todos os `[ ]` acima marcados como `[x]` e:

- [ ] `npm test` passa sem skips
- [ ] `npx convex deploy` em ambiente dev sem erros de schema
- [ ] Fluxo end-to-end manual: criar campanha → gerar mundo → criar personagem → enviar mensagem → ver resposta streamed com tool calls persistidos → verificar fatos extraídos → forçar compel → resolver → ver continuação → trocar cena → ver resumo gerado
