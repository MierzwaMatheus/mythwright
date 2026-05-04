# Mythwright — Backend Tasks (parte 2) até MVP

Cada `[ ]` é uma task pendente. `[x]` = concluída.
Referências a `@docs/` indicam onde buscar contexto antes de implementar.

Pré-condição: `tasks.md` (parte 1) totalmente concluído. As tasks abaixo cobrem **gaps de integração**, **conexões finais** e **ajustes técnicos** descobertos após auditoria do código produzido nas Fases 0–3.

---

## Fase 4 — Integração de Memória Semântica no Loop de Turno

### Embedding da Mensagem do Jogador — G-101

> Contexto: `@docs/02-technical-architecture.md` §3.2 (Estágio 2 — montagem do contexto) e `@docs/01-gap-report.md` G-009

`convex/messages.ts` já expõe `setEmbeddingInternal`, mas **nenhum caller agenda o embedding da mensagem do jogador** após sua criação. Sem isso, o vectorIndex de `messages` permanece vazio e a busca semântica de turnos passados não funciona.

- [x] Criar `internalAction embedMessage(messageId)` em `convex/lib/embedding.ts` que lê o conteúdo da mensagem, chama `generateEmbedding`, e persiste via `messages.setEmbeddingInternal`
- [x] Em `convex/messages.ts:createMessage`, agendar `ctx.scheduler.runAfter(0, internal.lib.embedding.embedMessage, { messageId })` após inserção bem-sucedida (apenas para `role === "player"` — mensagens do GM são embedadas no Estágio 7)
- [x] No fim do Estágio 7 do `processTurnFull`, agendar `embedMessage` para a mensagem GM finalizada
- [x] Testar que `createMessage` agenda embedding para mensagem do player
- [x] Testar que `processTurnFull` finaliza com embedding da resposta do GM persistido

### Recuperação Semântica em `buildFullContext` — G-102

> Contexto: `@docs/02-technical-architecture.md` §3.2 e §5 (vector search) e `@docs/01-gap-report.md` G-007

Hoje `processTurnFull.ts:163-166` envia ao LLM apenas `[system, user]` — sem histórico, sem ficha, sem fatos recuperados, sem cena. A função `buildFullContext` existe e é testada, mas **nunca é chamada**. As tabelas `entities`, `facts`, `summaries` têm vectorIndex prontos mas nenhum caller os consulta.

- [x] Criar helper `lib/semanticMemory.ts` com `retrieveSemanticContext(ctx, { campaignId, sceneId, queryEmbedding, limits })` que executa em paralelo:
  - `vectorSearch` em `facts` filtrando `visibility ∈ {known, rumored}` (top-K conforme PRD; default 5)
  - `vectorSearch` em `entities` filtrando `visibility ∈ {known, rumored}` (top-K; default 5)
  - `vectorSearch` em `summaries` filtrando `level ∈ {scene, arc}` (top-K; default 3)
- [x] No Estágio 2 do `processTurnFull`:
  - Aguardar embedding da mensagem do jogador (chamar `generateEmbedding` síncrono — não esperar scheduler)
  - Chamar `retrieveSemanticContext` com esse embedding
  - Buscar `character` ativo da campanha
  - Buscar últimas N mensagens da cena (janela curta — usar `messages.getMessagesByScene`)
  - Buscar `sceneAspects` da cena ativa
  - Chamar `buildFullContext` com tudo isso e usar como `messages` enviadas ao LLM (em vez de só system + user crus)
- [x] Testar `retrieveSemanticContext` com mock de embedding e dados seeds
- [x] Testar que `processTurnFull` envia ao LLM um array de mensagens com histórico e contexto semântico (verificar payload com mock)

### Integração de Gatilhos no Loop — G-103

> Contexto: `@docs/02-technical-architecture.md` §3.3 (Estágio 3) e `@docs/01-gap-report.md` G-004

`classifyTriggers` foi implementado e testado isoladamente. **Não é chamado pelo `processTurnFull`.** A pipeline completa de 3 fases (pré-filtro → vectorSearch → LLM classifier) precisa rodar antes do Estágio 4.

- [x] No Estágio 3 do `processTurnFull`, antes da chamada ao LLM narrativo:
  - Chamar `triggers.getArmedTriggersByScope` para obter candidatos pré-filtrados (cena ativa + globais)
  - Aplicar `vectorSearch` em `triggers` usando o embedding da mensagem do jogador, filtrando `status = "armed"` e `scope` relevante; combinar resultado com pré-filtro (top-K por similaridade)
  - Chamar `internal.classifyTriggers.classifyTriggers` com a mensagem do jogador e os candidatos
  - Para cada trigger ativado: chamar `triggers.resolveTriggerEffects` (executa efeitos) e adicionar `triggerId` em `triggersFired`
  - Passar resumo dos eventos disparados para `buildFullContext` (já tem o parâmetro `triggeredEvents`) para que o GM tenha consciência do que mudou
- [x] Persistir `triggersFired` na mensagem GM no Estágio 7
- [x] Testar que mensagem do jogador → trigger relevante ativa → efeito é executado antes da resposta do GM
- [x] Testar que trigger `oneShot: true` muda status para `fired` e não dispara novamente
- [x] Testar que trigger `oneShot: false` permanece `armed` após disparar

### Anti-leak com Hidden Facts Recuperados — G-104

> Contexto: `@docs/02-technical-architecture.md` §3.5 (Estágio 5) e `@docs/01-gap-report.md` G-024

`processTurnFull.ts:283` chama `validateAntiLeak` com `hiddenFacts: []` hard-coded. Sem hidden facts no input, a validação não tem base para detectar vazamento real.

- [x] No Estágio 5 do `processTurnFull`, antes de chamar `validateAntiLeak`:
  - Executar `vectorSearch` em `facts` filtrando `visibility = "hidden"`, usando o embedding da mensagem GM gerada (top-K; default 10)
  - Passar essa lista para `validateAntiLeak`
- [x] Testar que `validateAntiLeak` recebe hidden facts relevantes (mock de vectorSearch)
- [x] Testar regeneração: hidden fact aparece na resposta → validateAntiLeak detecta → regenera

### Paralelismo de Estágios 5 e 6 — G-105

> Contexto: `@docs/02-technical-architecture.md` §3.5–3.6 e `@docs/01-gap-report.md` G-022

Hoje no `processTurnFull.ts:278-300`, o anti-leak roda primeiro e só depois o `extractAndPersistFacts`. PRD prevê os dois em paralelo para reduzir latência (~1-2s por turno).

- [x] Refatorar para `Promise.all([validateAntiLeak(...), extractAndPersistFacts(...)])` quando `antiLeakEnabled === true`
- [x] Tratar caso onde `validateAntiLeak` detecta vazamento mas `extractAndPersistFacts` já persistiu fatos: não há corrupção (fatos extraídos da mensagem vazada permanecem válidos como conhecimento do mundo)
- [x] Quando `antiLeakEnabled === false`, manter apenas `extractAndPersistFacts`
- [x] Testar que ambas as actions executam concorrentemente (verificar via timing ou mock counter)

---

## Fase 5 — BYOK Real e Configuração por Usuário

### Encaminhamento da Chave OpenRouter do Usuário — G-106

> Contexto: `@docs/02-technical-architecture.md` §7 (integração OpenRouter) e PRD §4 (BYOK)

Todas as chamadas LLM hoje usam `process.env.OPENROUTER_API_KEY` (variável global do deploy). O PRD especifica BYOK — cada usuário fornece sua chave via `users.saveOpenRouterKey`, que é criptografada. **Nenhum caller descriptografa e usa essa chave.**

- [x] Criar helper `lib/llmAuth.ts` com `internalAction getDecryptedOpenRouterKey(userId)` que lê `users.encryptedOpenRouterKey` e descriptografa via `lib/crypto.decryptValue`
- [x] Refatorar `processTurnFull` para receber o `userId` (ou derivar de `campaign.userId`) e usar `getDecryptedOpenRouterKey` em vez de `process.env`
- [x] Refatorar `classifyTriggers`, `summarizeScene`, `summarizeArc`, `generateWorld`, `generateCharacter`, `prompts/antiLeak.validateAntiLeak`, `prompts/factExtraction.extractAndPersistFacts` para receberem a chave descriptografada como parâmetro (em vez de lerem env)
- [x] Manter fallback para `process.env.OPENROUTER_API_KEY` apenas em dev/test (controlado por flag explícita ou ausência de chave do usuário)
- [x] Testar que turno com chave do usuário usa a chave correta no header `Authorization`
- [x] Testar que turno sem chave do usuário falha graciosamente com erro `"openrouter_key_missing"`

### Provedor de Embedding Configurável — G-107

> Contexto: `@docs/01-gap-report.md` G-009 e PRD decisão "embeddings via Together AI/HF"

`convex/lib/embedding.ts:11` lê `process.env.TOGETHER_API_KEY`, mas nada indica se a chamada acontece via Together, OpenRouter ou HF. Modelo é hard-coded.

- [x] Confirmar provedor: usar OpenRouter (consistência com narrativa/utility) **ou** Together AI (mais barato para embedding) — decidir e documentar em `convex/lib/embedding.ts` no topo do arquivo
- [x] Ler modelo de `campaign.llmConfig.embeddingModel` (default `BAAI/bge-m3`) em vez de hard-code
- [x] Se provedor for Together: aceitar `TOGETHER_API_KEY` como BYOK
- [ ] Se provedor for OpenRouter: usar a mesma chave do usuário descriptografada (G-106)
- [x] Validar que retorno tem dimensão 1024 (compatível com `vectorIndex` do schema); falhar com erro claro se diferente

### LLM Config Resolver com Fallback — G-108

> Contexto: `@docs/01-gap-report.md` G-015

`lib/llmConfig.ts` foi criado, mas precisa garantir que defaults open-source são sempre aplicados quando faltam campos parciais (ex: campanha tem `narrativeModel` definido mas não `utilityModel`).

- [x] Refatorar `getLlmConfig` para fazer merge profundo: `{ ...DEFAULTS, ...campaign.llmConfig }` em vez de retornar tudo-ou-nada
- [x] Definir `DEFAULTS` no topo do arquivo: `narrativeModel: "deepseek/deepseek-chat"`, `utilityModel: "meta-llama/llama-3.1-8b-instruct"`, `extractionModel: "qwen/qwen-2.5-32b-instruct"`, `embeddingModel: "BAAI/bge-m3"`
- [x] Testar que campanha com `llmConfig: { narrativeModel: "x" }` retorna `{ narrativeModel: "x", utilityModel: DEFAULTS.utilityModel, ... }`

---

## Fase 6 — Auth Provider e Segurança

### Convex Auth Provider — G-109

> Contexto: `@docs/01-gap-report.md` G-027

`convex/lib/auth.ts:getAuthenticatedUser` espera `ctx.auth.getUserIdentity()`, mas não existe `convex/auth.config.ts`, `convex/auth.ts` (Convex Auth) nem nenhuma configuração de provider. Sem isso, autenticação real não funciona em produção.

- [x] Decidir provedor de auth: Convex Auth (Password) ou OAuth (Google/GitHub) — decidir e documentar
- [x] Criar `convex/auth.config.ts` conforme escolha
- [x] Criar `convex/auth.ts` com `convexAuth({ providers: [...] })` (Convex Auth) ou config equivalente
- [x] Garantir que `users.upsertFromAuth` é chamado no callback de login (criar user se primeira vez, atualizar `displayName`/`avatar` se já existir)
- [x] Testar `getAuthenticatedUser` com identidade mockada
- [x] Testar fluxo: login → upsert user → token válido em queries/mutations

### Sanitização de `users.list` — G-110

> Contexto: `@docs/01-gap-report.md` G-026

A task original pedia "remover ou restringir a admin a query `users.list`". Confirmar que foi feita corretamente — não basta marcar como `[x]` se a função ainda expõe todos os usuários sem checagem.

- [x] Verificar `convex/users.ts` linha original (~88-95): a query `list` deve estar (a) removida, (b) restrita por flag `user.isAdmin` no schema, ou (c) limitada a retornar apenas o próprio usuário autenticado
- [x] Adicionar teste que confirma comportamento atual (impossível listar outros usuários sem flag de admin)

---

## Fase 7 — Hardening do Loop de Tool Calling

### Limite de Iterações de Tool Calling — G-111

> Contexto: `@docs/02-technical-architecture.md` §4 (orquestração de tools com streaming) e PRD §12 (riscos)

O loop em `processTurnFull` itera enquanto o stream produz `tool_call` events. Sem limite, um modelo confuso pode entrar em loop infinito de tools chamando tools — risco de custo descontrolado.

- [x] Adicionar contador `toolCallCount` no loop principal de `processTurnFull`
- [x] Definir constante `MAX_TOOL_CALLS_PER_TURN = 10` no topo do arquivo
- [x] Quando `toolCallCount > MAX_TOOL_CALLS_PER_TURN`: abortar geração, marcar mensagem como `failed`, retornar `{ success: false, reason: "tool_call_limit_exceeded" }`
- [x] Testar com mock de stream que emite 11 tool calls — verificar abort no 11º

### Re-prompt Após Tool Call — G-112

> Contexto: `@docs/02-technical-architecture.md` §4

OpenAI/OpenRouter tool calling exige um padrão específico: após executar a tool, reenviar todo o histórico ao LLM **incluindo** a mensagem `assistant` com `tool_calls` e a mensagem `tool` com `content` do resultado, então o LLM continua a narrativa. O loop atual em `processTurnFull` apenas registra a tool call mas não reenvia ao LLM o resultado para que ele continue a narrativa após a tool. Verificar se esse fluxo está correto.

- [x] Auditar `processTurnFull.ts:176-249`: confirmar se há um segundo `callLlm` com histórico atualizado após tool execution, ou se o stream original continua naturalmente após o tool_call delta
- [x] Se faltar: implementar continuação — após executar tool e ter `toolResult`, fazer `callLlm` adicional com:
  ```
  [...llmMessages, { role: "assistant", tool_calls: [...] }, { role: "tool", tool_call_id, content: JSON.stringify(toolResult) }]
  ```
- [x] Testar fluxo: GM rola dado → tool executa → GM continua narrativa descrevendo o resultado

### Tool Call Mal-formado — G-113

> Contexto: `@docs/02-technical-architecture.md` §4 (plano B com marcadores em texto)

Modelos open-source podem emitir tool calls com argumentos JSON inválidos ou nomes de tool inexistentes. Hoje em `processTurnFull.ts:51-53` há `try { params = JSON.parse(...) } catch {}` que silencia o erro.

- [x] Quando `toolName` não existe em `FATE_TOOLS`: registrar warning, **não** executar, continuar stream (não abortar turno)
- [x] Quando `toolParams` JSON falha: tentar fallback simples (`{}`) e logar; se tool exige campos obrigatórios, retornar erro estruturado como `toolResult: { error: "invalid_params" }` para o LLM saber
- [x] Testar que tool desconhecida não quebra o turno
- [x] Testar que tool com params inválidos retorna erro estruturado e turno completa

---

## Fase 8 — Geração de Mundo e Personagem: Conexões Finais

### `setupStatus` Refletindo Estado Real — G-114

> Contexto: `@docs/01-gap-report.md` G-010

A task da Fase 3 pediu adicionar `setupStatus` em `campaigns`. Confirmar que é setado corretamente em todos os pontos do ciclo de vida.

- [x] Verificar schema: `setupStatus: v.optional(v.union(v.literal("draft"), v.literal("generating"), v.literal("ready")))` em `campaigns` — adicionar se ausente
- [x] `campaigns.createCampaign` define `setupStatus: "draft"` ao criar
- [x] `generateWorld` muda para `"generating"` ao iniciar e `"ready"` ao concluir com sucesso
- [x] `generateWorld` reverte para `"draft"` em caso de falha (não deixa em `"generating"` órfão)
- [x] `processTurnFull` rejeita turnos quando `setupStatus !== "ready"` (retorna `{ success: false, reason: "campaign_not_ready" }`)
- [x] Testar transições: draft → generating → ready
- [x] Testar que falha de LLM em `generateWorld` reverte para `draft` corretamente

### Geração de Personagem Persistindo na Campanha — G-115

> Contexto: `@docs/01-gap-report.md` G-012

`generateCharacter` foi implementado, mas precisa confirmar que:
1. Resultado é persistido em `characters` da campanha (não retornado solto)
2. Aspectos seguem estrutura FATE Condensed (Conceito Alto + Tribulação + 3 outros)
3. Stress tracks são inicializados com tamanho correto (3 caixas físicas, 3 mentais por padrão; estendido se Vigor/Vontade ≥ +3)

- [x] Auditar `generateCharacter.ts`: verificar se chama `characters.createCharacter` ao final ou se apenas retorna o objeto parseado
- [x] Se não persiste: adicionar passo de persistência via mutation interna
- [x] Validar estrutura mínima do output: `aspects.length >= 5`, `skills` com pelo menos 5 entries, `fatePoints: 3` (default), `stress.physical.length >= 3`, `stress.mental.length >= 3`
- [x] Estender `stress.physical` para 4 caixas se `skills.Vigor >= 3`; mesmo para mental com Vontade
- [x] Testar que `generateCharacter` cria registro em `characters` com todos os campos válidos

### Idempotência da Geração de Mundo — G-116

> Contexto: `@docs/02-technical-architecture.md` §6 (idempotência)

`generateWorld` pode ser chamado mais de uma vez (retry, reagendamento). Sem idempotência, pode duplicar entidades/fatos/triggers.

- [ ] Adicionar guard no início de `generateWorld`: se `campaign.setupStatus === "ready"` ou já existem entidades para a campanha, retornar sem reexecutar
- [ ] Para retry após falha parcial: limpar registros parciais (entidades/fatos/triggers da campanha sem cena associada) antes de reexecutar **ou** usar `setupStatus: "generating"` como lock
- [ ] Testar que segundo chamado de `generateWorld` em campanha `ready` é no-op
- [ ] Testar que `generateWorld` interrompido (mock que falha no meio) pode ser re-executado sem duplicar dados

---

## Fase 9 — Higiene Final

### Remoção do `processTurn` Antigo — G-117

Existem dois arquivos: `convex/processTurn.ts` (versão antiga, simples) e `convex/processTurnFull.ts` (versão dos 8 estágios). Manter os dois é fonte de confusão.

- [ ] Auditar quais helpers de `processTurn.ts` ainda são usados (`markMessageStatus`, `updateGmMessageContent`)
- [ ] Mover esses helpers para `processTurnFull.ts` ou para `convex/lib/messageState.ts`
- [ ] Atualizar todos os imports
- [ ] Deletar `convex/processTurn.ts` e `convex/processTurn.test.ts` (ou renomear teste para apontar pra nova localização)
- [ ] Renomear `processTurnFull.ts` → `processTurn.ts` (nome canônico)
- [ ] Confirmar que `npm test` continua passando

### Logging Estruturado — G-118

> Contexto: PRD §11 (métricas)

Para diagnosticar problemas em produção, cada turno precisa logar eventos-chave de forma estruturada (não `console.log` solto).

- [ ] Criar `convex/lib/logger.ts` com `logTurnEvent({ turnId, stage, event, data })` que faz `console.log(JSON.stringify({ turnId, stage, event, ...data, ts: Date.now() }))`
- [ ] Em `processTurnFull`, logar entrada/saída de cada estágio (`stage_start`, `stage_end`) com duração em ms
- [ ] Logar tool calls executadas (`tool_executed` com `toolName`, `success`, `durationMs`)
- [ ] Logar regenerações por anti-leak (`regeneration` com `attempt`, `reason`)
- [ ] Logar consumo de tokens (`tokens_used` com `input`, `output`, `model`)
- [ ] Não logar conteúdo de mensagens (privacidade) — apenas IDs e métricas
- [ ] Testar que logger não quebra quando `data` tem objetos cíclicos (proteger com `try`)

### Validação do Schema do Turno End-to-End — G-119

Antes de declarar MVP backend completo, escrever um teste de integração que exercita o fluxo completo com mocks coordenados.

- [ ] Criar `convex/processTurnFull.e2e.test.ts` que:
  - Cria user + campaign + character + scene + alguns facts/entities/triggers seedados
  - Mocka `generateEmbedding` (retorna vetor determinístico)
  - Mocka chamada LLM narrativa (retorna stream com 1 text + 1 `roll_fate_dice` + mais texto)
  - Mocka chamada LLM utility (anti-leak retorna `{ vazou: false }`, classifyTriggers retorna 1 trigger)
  - Chama `processTurnFull` e verifica:
    - Mensagem GM persistida com `content` correto
    - `diceRolls` row criada com `seed` e `outcome`
    - `triggersFired` na mensagem GM
    - `factsRevealed` se trigger revelou fato
    - `tokensUsed` populado
    - Embedding da mensagem GM agendado
- [ ] Verificar que esse teste cobre: idempotência, paralelismo 5/6, hidden facts no anti-leak, BYOK

---

## Critério de MVP Backend Completo (Atualizado)

Todos os `[ ]` acima marcados como `[x]` **e**:

- [ ] Teste E2E (G-119) passa
- [ ] `npm test` passa sem skips
- [ ] `npx convex deploy` em ambiente dev sem erros de schema
- [ ] Em deploy de dev real (sem mocks): turno completo com chave OpenRouter de usuário gera resposta streamed com pelo menos 1 tool call persistido em `diceRolls` e métricas em `tokensUsed`
- [ ] Custo médio por turno ≤ $0.025 USD (PRD §11) — medido em pelo menos 5 turnos reais
- [ ] Latência primeiro token ≤ 12s (PRD RNF-001) — medido em pelo menos 5 turnos reais
- [ ] Documentação em `docs/05-runbook-backend.md` (a criar) com: como configurar variáveis de ambiente, como rodar deploy dev, como debugar turno que falhou
