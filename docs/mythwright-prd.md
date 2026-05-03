# Mythwright — Product Requirements Document

**Versão:** 1.0 (PRD Inicial)
**Data:** Maio 2026
**Autor:** Matheus Mierzwa
**Status:** Planejamento — Pré-implementação

---

## Sumário Executivo

Mythwright é uma aplicação web single-player para sessões de RPG narrativo conduzidas por um Mestre baseado em IA. O sistema usa as regras do FATE Condensed (SRD) como esqueleto mecânico e narrativo, e aplica uma arquitetura de memória em camadas para garantir que o Mestre IA mantenha coerência ao longo de campanhas longas, separando rigorosamente o conhecimento do mundo do conhecimento do personagem.

O diferencial técnico central é a resolução do problema clássico de "memória de agente" em três frentes simultâneas: memória episódica (o que aconteceu) via resumos hierárquicos com busca semântica, estado do mundo (o que existe) via grafo de entidades versionado, e gerenciamento de visibilidade (o que o jogador sabe) via sistema de gatilhos vetoriais que escala para milhares de eventos sem custo proibitivo de inferência.

O produto utiliza exclusivamente modelos open-source via OpenRouter, mantendo o custo por turno em uma faixa que permite tanto modelo BYOK (bring-your-own-key) quanto monetização via assinatura ou créditos com margem saudável.

---

## 1. Visão e Premissa do Produto

### 1.1 Problema

Jogadores que querem experiências de RPG narrativas profundas enfrentam três barreiras crônicas:

A primeira é a disponibilidade. Mestres humanos são raros, agendar grupos é difícil, e campanhas longas frequentemente colapsam por logística. A segunda é a personalização. Sistemas existentes de "RPG com IA" (AI Dungeon, NovelAI, etc) priorizam geração de texto livre e perdem coerência rápido — o jogador percebe que o "mestre" esqueceu fatos, contradiz NPCs, ou inventa informações que o personagem não deveria saber. A terceira é a profundidade mecânica. Aplicações narrativas puras descartam regras; aplicações com regras (simuladores de D&D) priorizam combate tático em vez de narrativa.

Mythwright ataca os três simultaneamente: disponibilidade total (jogador joga sozinho, quando quiser), coerência forte (arquitetura de memória dedicada que diferencia mundo de conhecimento), e mecânica narrativa (FATE Condensed como sistema leve e focado em ficção).

### 1.2 Visão

Construir o melhor Mestre de RPG por IA do mercado para campanhas narrativas solo, com qualidade de coerência indistinguível de um GM humano experiente em sessões de até 50 horas de jogo cumulativo.

### 1.3 Princípios de Produto

O produto adere a quatro princípios não-negociáveis que guiam todas as decisões subsequentes.

**Coerência sobre velocidade.** É preferível uma resposta de 8 segundos que respeite o estado do mundo do que uma de 2 segundos que vaze um segredo. A latência percebida é gerenciada via streaming e indicadores visuais durante operações pesadas, não via cortes na qualidade da memória.

**O jogador é co-autor, não passageiro.** O sistema híbrido de criação de campanha, o cheat mode, e a edição manual de fatos/gatilhos refletem a postura de que o jogador deve ter controle total quando quiser, mesmo que escolha não exercê-lo.

**Mecânicas servem narrativa.** FATE foi escolhido precisamente porque suas mecânicas (Aspectos, invocação, compelir, consequências) são gatilhos narrativos disfarçados de regras. O Mestre IA aplica regras quando elas geram cena interessante e ignora quando seriam burocracia.

**Determinismo onde importa, criatividade onde libera.** Rolagens de dados são determinísticas e auditáveis. Geração de texto é criativa e variável. Os dois não se misturam: o LLM nunca "imagina" um resultado de dado.

### 1.4 Não-objetivos (escopo explicitamente fora)

Para evitar dispersão durante a construção, o produto explicitamente não tenta:

Suportar múltiplos sistemas de RPG no MVP. Apenas FATE Condensed. Suportar multiplayer/party. Apenas solo (extensibilidade futura considerada no schema). Substituir Virtual Tabletops como Roll20/Foundry. Não há mapas, tokens, grids, ou theater-of-the-mind visual. Gerar imagens, áudio, ou voz no MVP. Texto puro. Importar conteúdo de Worlds of Adventure ou outros materiais FATE existentes. Apenas geração assistida do zero. Funcionar offline. Cliente sempre conectado ao backend Convex.

---

## 2. Personas e Jornadas

### 2.1 Persona Primária: O Solo Roleplayer

Pessoa entre 25-45 anos, conhece RPG (já jogou D&D, Pathfinder, ou similar), tem interesse em narrativa, mas tempo limitado e/ou dificuldade em encontrar grupo. Pode ser ex-jogador querendo voltar, novato curioso, ou veterano que joga em grupo mas quer um espaço próprio para experimentar personagens e cenários.

Suas dores específicas: frustração com IAs genéricas que perdem coerência, vontade de jogar em horários flexíveis, desejo de experimentar tons e cenários que o grupo dele não toparia.

Seu sucesso é definido por: completar pelo menos uma campanha curta (one-shot ou medium) sentindo que a história teve começo, meio e fim coerentes, com pelo menos um momento memorável que ele lembraria semanas depois.

### 2.2 Persona Secundária: O GM em Pesquisa

Mestre de RPG humano que usa Mythwright como ferramenta de prototipação — testa cenários, NPCs, gatilhos antes de levar pra mesa real. Valoriza o cheat mode profundamente. Precisa exportar conteúdo gerado para uso em outras plataformas (futuro, fora do MVP).

### 2.3 Jornada Principal — Primeira Campanha

A jornada do novo usuário, do cadastro à terceira sessão de jogo, define a experiência de produto. Ela tem cinco marcos.

**Marco 1: Onboarding (5 minutos).** Usuário cria conta, lê uma introdução curta sobre o que é Mythwright, escolhe entre "vou jogar minha primeira campanha" ou "quero entender FATE primeiro" (este último abre tutorial de regras opcional).

**Marco 2: Criação de Campanha (10-20 minutos).** Usuário define premissa, IA gera mundo/NPCs/gatilhos, usuário edita o que quiser, define ou gera personagem, revisa, inicia.

**Marco 3: Primeira Cena (15-30 minutos).** GM IA narra abertura, jogador interage, primeira rolagem acontece, jogador sente o ritmo do sistema.

**Marco 4: Primeira Revelação (sessão 1 ou 2).** Um gatilho dispara, um fato `hidden` se torna `known`, o GM narra a descoberta de forma natural. Esse é o momento de validação central do produto: o jogador percebe que o sistema lembra e revela com intencionalidade.

**Marco 5: Conclusão da Primeira Campanha (5-30 sessões dependendo do escopo).** Campanha termina (manualmente pelo jogador ou por arco narrativo concluído). Sistema oferece arquivar e iniciar próxima.

---

## 3. Requisitos Funcionais

Os requisitos estão agrupados por área funcional. Cada requisito recebe um identificador `RF-XXX` para referência cruzada futura.

### 3.1 Autenticação e Conta

**RF-001 — Registro e login.** Sistema utiliza Convex Auth com login por email/senha e opcionalmente OAuth (Google). Conta armazena email, nome de exibição, e avatar opcional.

**RF-002 — Sessão persistente.** Sessão do usuário persiste entre visitas. Logout explícito limpa sessão.

**RF-003 — Configuração de chave OpenRouter (BYOK opcional).** Usuário pode opcionalmente fornecer chave própria do OpenRouter nas configurações. Quando presente, todas as chamadas LLM da conta usam essa chave. Quando ausente, usam a chave do sistema (sujeito a quotas/billing do plano).

### 3.2 Gerenciamento de Campanhas

**RF-010 — Listagem de campanhas.** Usuário vê lista de suas campanhas com status (setup, active, paused, archived), última atividade, e contagem de sessões/turnos.

**RF-011 — Criação de campanha (fluxo híbrido).** Detalhado na seção 6.2. Wizard de 4 fases: premissa, geração de mundo, personagem, revisão.

**RF-012 — Pausar e retomar campanha.** Usuário pode pausar campanha ativa. Pausa preserva estado completo. Retomar reabre na cena exata.

**RF-013 — Arquivar campanha.** Campanhas concluídas ou abandonadas podem ser arquivadas. Arquivadas não aparecem na listagem principal mas permanecem acessíveis em "arquivo".

**RF-014 — Excluir campanha.** Exclusão permanente após confirmação dupla. Remove todos os dados associados (mensagens, entidades, fatos, gatilhos, sumários, rolagens).

**RF-015 — Configurar campanha.** Usuário pode editar tom, premissa, modelos LLM em uso, e flags (cheat mode, validação anti-vazamento) a qualquer momento.

### 3.3 Loop de Jogo

**RF-020 — Envio de mensagem.** Jogador envia mensagem de texto livre. UI mostra mensagem imediatamente, indica processamento, e renderiza resposta do GM via streaming.

**RF-021 — Resposta do GM com tools.** GM responde em streaming. Durante a resposta, pode chamar tools mecânicas (rolagens, invocações, etc). Tool calls aparecem inline na UI como blocos visuais distintos.

**RF-022 — Tool: rolagem de dados FATE.** Detalhado na seção 8.

**RF-023 — Tool: invocação de Aspecto.** Detalhado na seção 8.

**RF-024 — Tool: compelir Aspecto.** Detalhado na seção 8. Esta tool pausa a resposta e exige interação do jogador.

**RF-025 — Tool: aplicar estresse e consequências.** Detalhado na seção 8.

**RF-026 — Tool: gerenciar Pontos de Destino.** Detalhado na seção 8.

**RF-027 — Tool: criar Aspecto de cena.** Detalhado na seção 8.

**RF-028 — Tool: mudar de cena.** Detalhado na seção 8.

**RF-029 — Tool: revelar fato/entidade.** Detalhado na seção 8. Uso parcimonioso pelo GM.

**RF-030 — Resolução automática de gatilhos.** A cada mensagem do jogador, o sistema avalia gatilhos candidatos via embedding + classificação. Gatilhos disparados causam mudanças de estado antes da resposta do GM.

**RF-031 — Validação anti-vazamento.** Se ativada na configuração da campanha, após resposta do GM, sistema verifica se fatos `hidden` foram revelados indevidamente. Se sim, regenera resposta.

**RF-032 — Extração automática de fatos.** Após resposta do GM, sistema extrai novos fatos narrados e os persiste com visibilidade apropriada.

**RF-033 — Resumo automático de cena.** Após N turnos (configurável, padrão 20) ou ao mudar de cena, sistema gera resumo da cena em background e o associa ao registro de cena.

**RF-034 — Resumo automático de arco.** Após M cenas (configurável, padrão 5), sistema gera resumo de arco agregando sumários de cena.

### 3.4 Ficha de Personagem

**RF-040 — Visualização de ficha.** Painel persistente (sidebar ou overlay) mostra ficha completa do personagem: aspectos, perícias, façanhas, Pontos de Destino, estresse, consequências.

**RF-041 — Edição manual de ficha.** Usuário pode editar manualmente qualquer campo da ficha a qualquer momento. Edições manuais são logadas com timestamp.

**RF-042 — Histórico de mudanças na ficha.** Usuário pode ver linha do tempo de mudanças (consequências adquiridas, Pontos gastos, etc) com link para a mensagem que causou cada mudança.

### 3.5 Cheat Mode (rota separada `/admin`)

**RF-050 — Acesso ao cheat mode.** Disponível apenas se `cheatModeEnabled: true` na configuração da campanha. Acesso via rota separada e link discreto.

**RF-051 — Visualização do WORLD_STATE.** Mostra todos os fatos da campanha (incluindo `hidden`), todas as entidades com seus segredos, todos os gatilhos armados.

**RF-052 — Edição de fatos.** Usuário pode adicionar, editar conteúdo, mudar visibilidade, ou excluir fatos. Mudanças refletem imediatamente no estado disponível ao GM.

**RF-053 — Edição de entidades.** Usuário pode adicionar, editar, ou excluir entidades (NPCs, locais, facções, itens, conceitos).

**RF-054 — Edição de gatilhos.** Usuário pode editar descrição, escopo, efeitos, status (armed/disabled), ou criar novos gatilhos manualmente.

**RF-055 — Forçar disparo de gatilho.** Usuário pode disparar um gatilho manualmente sem esperar a condição natural. Útil para testes e correções narrativas.

**RF-056 — Inserção de mensagem do sistema.** Usuário pode inserir mensagem do tipo `system` na timeline (anotações pessoais, lembretes, retcons) sem afetar histórico do GM.

### 3.6 Histórico e Memória

**RF-060 — Visualização de histórico de turnos.** Usuário pode rolar histórico completo de mensagens da campanha. Carregamento paginado/incremental para campanhas longas.

**RF-061 — Busca em histórico.** Usuário pode buscar texto livre no histórico. Resultados destacam ocorrência e permitem navegar até o turno.

**RF-062 — Visualização de cenas e arcos.** Usuário pode ver árvore de cenas/arcos com sumários expansíveis.

**RF-063 — Export de campanha.** v2. Fora do MVP.

---

## 4. Requisitos Não-Funcionais

### 4.1 Performance

**RNF-001 — Latência de resposta do GM.** Tempo até primeiro token do stream ≤ 8 segundos no percentil 95. Tempo até resposta completa ≤ 20 segundos no percentil 95 para respostas sem tool calls extensos. Respostas com múltiplas rolagens podem chegar a 30 segundos no percentil 95.

**RNF-002 — Latência de operações leves.** Operações de listagem, navegação entre cenas, e visualização de ficha respondem em ≤ 200ms no percentil 95 (são queries Convex puras, sem LLM).

**RNF-003 — Streaming responsivo.** Tokens chegam ao cliente em batches frequentes (a cada ~50-100ms ou ~20 tokens). Indicador visual ativo durante toda a operação.

### 4.2 Confiabilidade

**RNF-010 — Idempotência de turno.** Mensagens reenviadas pelo cliente (refresh, reconexão) não geram turnos duplicados. Identificadores únicos por turno garantem processamento único.

**RNF-011 — Recuperação de falha em estágios.** Se um estágio do turno falhar (timeout do LLM, erro do OpenRouter), o sistema marca a mensagem como `failed`, preserva o estado parcial (incluindo gatilhos já disparados), e oferece ao jogador a opção de regenerar.

**RNF-012 — Persistência durante streaming.** Tokens são persistidos incrementalmente. Se a conexão cair durante o stream, o cliente recebe o que foi gerado até o momento ao reconectar.

**RNF-013 — Auditoria de rolagens.** Todas as rolagens de dados são determinísticas com seed armazenada e podem ser reproduzidas exatamente.

### 4.3 Segurança e Privacidade

**RNF-020 — Isolamento por usuário.** Toda query Convex valida que o `userId` autenticado é o dono da campanha sendo acessada. Não há rotas que vazem dados entre usuários.

**RNF-021 — Armazenamento de chaves BYOK.** Chaves OpenRouter de usuário são armazenadas com criptografia em repouso. Nunca expostas a outros usuários nem retornadas em queries que não sejam explicitamente do dono.

**RNF-022 — Conteúdo sensível.** Sistema permite temas adultos e maduros (violência, conflito, drama) inerentes ao RPG, mas o prompt do GM inclui guardrails contra geração de conteúdo sexual explícito não solicitado, exploração de menores, ou material flagrantemente ilegal.

**RNF-023 — Logs de inferência.** Prompts e completions enviados ao OpenRouter são logados (apenas para o dono da campanha) por 30 dias para debugging e podem ser purgados a pedido.

### 4.4 Custo

**RNF-030 — Custo por turno alvo.** Mediana de custo por turno em modelos open-source padrão (DeepSeek V3 narrativa + Llama 3.1 8B utility) deve permanecer entre US$ 0,006 e US$ 0,025.

**RNF-031 — Limite de tokens por contexto.** Contexto montado por turno deve permanecer ≤ 16k tokens em campanhas até 100 turnos, e ≤ 24k tokens em campanhas longas. Compressão via resumos hierárquicos garante o limite.

**RNF-032 — Cache de prompt.** System prompt fixo e ficha do personagem são marcados como conteúdo cacheável quando o provedor OpenRouter suporta.

### 4.5 Escalabilidade

**RNF-040 — Volume de campanhas por usuário.** Usuário pode ter até 50 campanhas (entre todos os status). Limite ajustável.

**RNF-041 — Volume de turnos por campanha.** Suporte a campanhas com até 2.000 turnos sem degradação perceptível de performance ou coerência. Limite teórico maior, mas otimizações futuras podem ser necessárias além desse ponto.

**RNF-042 — Volume de gatilhos por campanha.** Suporte a até 10.000 gatilhos armados simultâneos por campanha sem que a fase de classificação ultrapasse 1 segundo (graças ao pré-filtro por escopo + vector top-K).

---

## 5. Arquitetura Técnica

### 5.1 Stack

A escolha de tecnologias reflete decisões já tomadas em outros projetos do ecossistema do desenvolvedor e prioriza velocidade de desenvolvimento sobre flexibilidade máxima.

Frontend: React 19 com TypeScript, Vite como bundler, Tailwind CSS para estilização, e shadcn/ui como base de componentes. Estado de servidor via Convex React Client (subscriptions reativas). Estado local via Zustand quando necessário. Roteamento via React Router.

Backend: Convex como plataforma única (banco de dados, auth, storage, vector search, jobs agendados, HTTP actions). Convex Auth para autenticação. Funções organizadas em `queries.ts`, `mutations.ts`, `actions.ts` por domínio.

LLM: OpenRouter como única integração. Suporte a múltiplos modelos open-source via roteamento configurável. Embeddings via OpenRouter ou diretamente via API do provedor (Hugging Face Inference, Together AI, etc).

Infraestrutura: Deploy via Vercel (frontend) e Convex Cloud (backend). CI/CD via GitHub Actions. Monorepo pnpm com possível separação futura entre web app, eventual mobile app, e shared types.

### 5.2 Arquitetura de Memória em Camadas

A solução para o problema central de coerência em campanhas longas é organizada em quatro camadas que se montam dinamicamente a cada turno.

A camada um é o contexto sempre presente. Inclui as regras compactas do FATE Condensed, persona e tom da campanha, ficha completa do personagem do jogador, e Aspectos do cenário. É essencialmente estática e cacheável, e ocupa entre 2.000 e 4.000 tokens.

A camada dois é o estado atual da cena. Inclui descrição da cena, NPCs presentes com informações visíveis ao jogador, local, objetivos ativos, e a janela curta das últimas 15-20 mensagens em texto bruto. Esta camada reflete o "agora" do jogo.

A camada três é a memória recuperada por relevância. A mensagem do jogador é convertida em embedding via `bge-m3`. O sistema executa busca vetorial top-K em três tabelas indexadas: sumários de cenas/arcos passados, fatos do PLAYER_KNOWLEDGE, e entidades conhecidas. Os top-K resultados de cada busca compõem o contexto recuperado, tipicamente entre 1.500 e 4.000 tokens.

A camada quatro é o sistema de resumos hierárquicos. A cada N turnos (padrão 20) ou ao mudar de cena, um job em background gera um sumário da cena. A cada M cenas (padrão 5), um sumário de arco é gerado a partir dos sumários de cena. A cada arco completado, opcionalmente um sumário de campanha é regenerado. Cada nível de sumário tem seu próprio embedding e participa da busca da camada três. Essa hierarquia garante que mesmo uma campanha de 2.000 turnos tenha contexto recuperável sem inflar tokens.

### 5.3 Sistema de Gatilhos

Gatilhos são a ponte entre WORLD_STATE (verdade absoluta) e PLAYER_KNOWLEDGE (verdade conhecida). Cada gatilho é um par condição-efeito que, quando ativado, transfere informação de uma camada para a outra ou executa modificações de estado.

A resolução de gatilhos a cada turno segue três fases para garantir escalabilidade.

A primeira fase é o pré-filtro determinístico. Apenas gatilhos com `status: armed` e escopo aplicável (global, ou cena/local atuais) são candidatos. Esta fase elimina tipicamente 80-95% dos gatilhos sem custo de LLM.

A segunda fase é a busca vetorial top-K. O embedding da mensagem do jogador é comparado com embeddings dos gatilhos pré-filtrados. Os top-10 mais similares avançam.

A terceira fase é a classificação por LLM utilitário. Um prompt estruturado pergunta ao Llama 3.1 8B (ou similar) quais dos 10 candidatos são genuinamente ativados pela mensagem do jogador, com justificativa e formato JSON forçado. Custo dessa classificação fica em frações de centavo por turno.

Gatilhos confirmados disparam suas ações via mutations Convex antes da geração da resposta do GM, garantindo que a resposta já reflita o novo estado.

### 5.4 Schema do Banco de Dados (Convex)

O schema completo está documentado em `convex/schema.ts` (arquivo de implementação). Esta seção apresenta o resumo conceitual.

**Tabelas principais:**

`users` — Contas de usuário gerenciadas pelo Convex Auth.

`campaigns` — Metadados da campanha, configurações, modelos LLM, e estado atual denormalizado.

`characters` — Fichas FATE de personagens. Modelado como N:1 com campaigns para preparar futura extensão multiplayer, embora MVP seja 1:1.

`scenes` — Cenas da campanha. Cada cena tem aspectos, NPCs presentes denormalizados, e referência ao sumário gerado.

`messages` — Todas as mensagens (player, gm, system) com vector index para busca semântica. Mensagens do GM podem incluir tool calls executadas durante a geração.

`entities` — NPCs, locais, facções, itens, e conceitos. Cada entidade tem visibilidade, descrição pública, possíveis stats FATE (para NPCs), e relações com outras entidades. Vector index para busca semântica.

`facts` — Átomos de conhecimento sobre o mundo. Cada fato tem visibilidade, conteúdo, entidades relacionadas, e (se conhecido) registro de como foi revelado. Vector index.

`triggers` — Gatilhos com descrição em linguagem natural, escopo, efeitos estruturados, e status. Vector index.

`summaries` — Resumos hierárquicos em três níveis: cena, arco, campanha. Vector index.

`diceRolls` — Auditoria completa de todas as rolagens executadas, com seed determinística para reproducibilidade.

**Indexação:**

Indexes regulares cobrem queries por `campaignId`, `userId`, status, e tipo. Vector indexes em `messages`, `entities`, `facts`, `triggers`, e `summaries` usam dimensão 1024 (compatível com `bge-m3`) e incluem campos de filtro para combinação de busca semântica + filtro categórico.


---

## 6. Fluxos Detalhados

### 6.1 Fluxo de Turno Completo

O turno é a unidade fundamental de interação. Cada turno consiste em uma mensagem do jogador seguida de uma resposta do GM, e atravessa oito estágios. Estágios 1 a 6 são síncronos do ponto de vista do turno (precisam concluir antes de fechar o turno), enquanto 7 e 8 são assíncronos e rodam em background.

**Estágio 1 — Recepção e persistência (mutation, ~10ms).** Cliente chama `sendMessage(campaignId, content, clientMessageId)`. Mutation valida ownership, grava mensagem em `messages` com status `pending`, agenda action `processTurn(messageId)`. Retorna ID. Cliente já vê a própria mensagem na UI via optimistic update.

**Estágio 2 — Montagem do contexto (action, ~200-400ms).** Action executa em paralelo: query do estado da campanha, query da janela curta de mensagens, embedding da mensagem do jogador, vector search em sumários, vector search em fatos `known`/`rumored`, vector search em entidades visíveis, e busca de gatilhos candidatos.

**Estágio 3 — Resolução de gatilhos (action, ~500-1000ms).** LLM utilitário classifica candidatos. Gatilhos confirmados executam mutations que mudam visibilidade de fatos, criam novas entidades, ou disparam outros eventos. Estado atualizado fica disponível para o próximo estágio.

**Estágio 4 — Geração da resposta do GM (action, ~3-15s, streamado).** LLM narrativo recebe contexto montado completo. Stream começa imediatamente. Tokens são gravados incrementalmente em `messages` via mutations frequentes. Tool calls pausam o stream, executam mutations correspondentes, e retomam o stream com o resultado.

**Estágio 5 — Validação anti-vazamento (action, ~500-1000ms).** Se ativada, LLM utilitário recebe a resposta gerada e a lista de fatos `hidden` relevantes, e responde se houve vazamento. Em caso positivo, a mensagem é marcada para regeneração e o estágio 4 é repetido com instrução adicional.

**Estágio 6 — Extração de fatos novos (action, paralelo a 5, ~500-1000ms).** LLM utilitário analisa a resposta do GM e extrai fatos novos a serem persistidos como `facts` ou atualizações em `entities`.

**Estágio 7 — Housekeeping (mutation, ~50ms).** Mensagem marcada como `complete`. Atualiza `campaign.lastActivityAt`. Avalia thresholds para resumos.

**Estágio 8 — Resumos em background (action agendada).** Se threshold atingido, agenda `summarizeScene` ou `summarizeArc`. Cada resumo gera embedding próprio e é persistido em `summaries`.

### 6.2 Fluxo de Criação de Campanha

A criação atravessa quatro fases, cada uma com checkpoint que persiste o draft no banco. Usuário pode abandonar e retomar a qualquer momento.

**Fase 1 — Premissa.** Formulário com campos: nome da campanha (texto), gênero/cenário (combinação de presets ou texto livre), tom (presets como "sério", "pulp", "sombrio", "cômico", combinados com livre), duração esperada (one-shot/medium/long), descrição livre opcional. Ao submeter, cria registro em `campaigns` com `status: setup` e avança.

**Fase 2 — Geração de Mundo.** Action chama LLM narrativo (DeepSeek V3) com prompt estruturado pedindo JSON com: visão geral do mundo, local inicial com aspectos, 3-5 NPCs iniciais, 2-3 facções, 10-15 fatos iniciais com mistura de visibilidades, 5-10 gatilhos plantados, e cena inicial. UI renderiza cada bloco como card editável. Jogador pode editar texto, regenerar item específico (botão "regenerar"), adicionar manualmente, ou excluir. Ao avançar, persiste todas as entidades, fatos, gatilhos, e cena inicial no banco.

**Fase 3 — Personagem.** Sub-fase opcional. Se jogador escolher "gerar com IA", informa premissa do personagem em texto livre, LLM gera ficha FATE completa em JSON, jogador edita. Se escolher "construir manualmente", wizard segue as 5 fases canônicas de criação FATE Condensed (high concept e trouble, fase 1 - aventura, fase 2 - cruzando caminhos, fase 3 - cruzando caminhos, perícias, façanhas).

**Fase 4 — Revisão e Início.** Tela única mostrando overview de tudo: mundo, personagem, cena inicial. Botões: "voltar e editar", "começar campanha". Ao começar, muda `status` para `active`, persiste cena ativa, gera primeira mensagem de abertura do GM (chamada ao LLM narrativo com prompt específico de abertura), redireciona para a interface de jogo.

### 6.3 Fluxo de Cheat Mode

Cheat mode é uma rota separada `/campaigns/:id/admin` que requer `cheatModeEnabled: true`. Layout de painel com abas: Visão Geral, Fatos, Entidades, Gatilhos, Cenas, Mensagens.

Visão Geral mostra estatísticas da campanha (turnos, fatos por visibilidade, gatilhos por status) e configurações editáveis.

Fatos mostra tabela ordenável e filtrável de todos os fatos. Cada linha tem ações inline: editar conteúdo, mudar visibilidade, ver entidades relacionadas, excluir. Botão "novo fato" abre formulário modal.

Entidades mostra grid de cards organizados por tipo. Cada card mostra nome, tipo, visibilidade, e snippet de descrição. Click abre editor completo com todas as propriedades incluindo stats FATE quando aplicável.

Gatilhos mostra tabela com descrição, escopo, status, efeitos resumidos. Ações: editar, desabilitar/habilitar, forçar disparo, excluir.

Cenas mostra timeline vertical de cenas com sumário expansível.

Mensagens mostra histórico completo com filtros por role, status, e busca textual. Ação especial: inserir mensagem `system` em qualquer ponto.

Todas as edições no cheat mode passam por confirmação antes de persistir, e geram entrada em log de auditoria visível na própria seção (planejamento futuro).


---

## 7. UI/UX por Tela

### 7.1 Princípios Visuais

A identidade visual de Mythwright deve evocar a sensação de manuscrito antigo encontrado em uma biblioteca esquecida, sem cair em estética "fantasia genérica". Inspiração de referência: combinação entre tipografia editorial moderna (estilo livros de poesia contemporânea) e elementos sutis de manuscrito (texturas de papel, marginalia ocasional). A paleta deve ser predominantemente neutra (creme/papel para light, ardósia profunda para dark) com um único accent que carregue significado. Sugestão de accent: âmbar antigo (algo como `#C8923A`), associado a "luz de vela" e "o saber revelado".

Tipografia: serif editorial para textos narrativos (sugestão: Lora ou Source Serif Pro), sans-serif moderna para UI (sugestão: Inter), e mono para mecânica/dados (sugestão: JetBrains Mono).

### 7.2 Tela: Dashboard de Campanhas

Layout de cartões em grid responsivo. Cada cartão mostra: nome da campanha com tipografia editorial, ilustração textual (primeira linha da premissa), status badge, métricas (sessões, turnos, última atividade), e ações (continuar, configurar, arquivar).

Cabeçalho da página tem botão proeminente "Nova Campanha" e abas: "Ativas", "Pausadas", "Arquivadas".

### 7.3 Tela: Criação de Campanha (4 fases)

Layout linear com indicador de progresso no topo (4 passos com estado: completo, atual, pendente). Cada fase ocupa o canvas central. Botões "voltar" e "avançar" no rodapé.

Fase 2 (Geração de Mundo) tem layout particular: após geração, blocos são apresentados como cartões expansíveis. Cada cartão tem header com tipo (NPC, Local, Fato, Gatilho), conteúdo editável inline, e botões: "editar", "regenerar", "excluir". Botão flutuante "adicionar manualmente" no canto.

### 7.4 Tela: Interface de Jogo (tela principal)

Layout em três colunas em desktop, colapsável em mobile/tablet.

Coluna esquerda (sidebar, ~280px): navegação da campanha. Mostra cena atual em destaque, lista de cenas anteriores acessíveis, link sutil para cheat mode quando habilitado.

Coluna central (canvas principal): chat. Mensagens do jogador alinhadas à direita com fundo neutro, mensagens do GM alinhadas à esquerda com tipografia serif e fundo levemente diferenciado. Tool calls (rolagens, invocações) aparecem como blocos visuais distintos inline no fluxo, com ícones e formatação que evocam mecânica (não emoji — formas SVG simples). Input de texto fixo no rodapé com botão de envio. Estados visuais: GM digitando (indicador animado), processando (mais sutil), erro (com ação de retry).

Coluna direita (sidebar, ~320px): ficha do personagem. Sempre visível em desktop, drawer em mobile. Mostra aspectos (compactos, primeiros listados em destaque), Pontos de Destino (com animação ao mudar), perícias (lista colapsável), estresse (caixas visuais), consequências (lista compacta). Botão "ver ficha completa" abre modal com tudo expandido e edição.

### 7.5 Tela: Cheat Mode

Layout administrativo: sidebar de navegação à esquerda com abas (Visão Geral, Fatos, Entidades, Gatilhos, Cenas, Mensagens), conteúdo principal à direita. Link de retorno discreto para o jogo no topo.

Tom visual deliberadamente mais "ferramenta de trabalho" e menos "experiência narrativa" — mais densidade de informação, menos serif, mais tabelas. A transição visual reforça a separação cognitiva entre "estar jogando" e "estar editando".

### 7.6 Estados Especiais

**Tool call inline.** Quando o GM rola dado, a UI mostra um bloco com: nome da perícia, modificadores aplicados (incluindo Aspectos invocados), animação dos 4 dados FATE rolando, resultado final, e outcome (`falha`, `empate`, `sucesso`, `sucesso com estilo`). Esse bloco fica permanentemente no histórico após a animação.

**Compelir Aspecto.** Quando o GM compelir um Aspecto, a resposta pausa e a UI mostra um modal centralizado com: o Aspecto sendo compelido, a complicação proposta pelo GM em prosa, e dois botões: "aceitar (+1 Ponto de Destino)" e "recusar (-1 Ponto de Destino)". Recusar requer Pontos disponíveis. A resposta do GM continua após a decisão.

**Stream interrompido / erro.** Se a geração falhar, mensagem aparece em estado `failed` com botão de regenerar. Histórico até o ponto da falha é preservado.

---

## 8. Mecânicas FATE como Sistema de Tools

Esta seção detalha as ferramentas estruturadas que o LLM narrativo invoca durante a geração de respostas. Cada tool é uma função Convex (action ou mutation) com schema bem definido, e seu nome, descrição e parâmetros são fornecidos ao LLM via tool calling do OpenRouter.

### 8.1 Catálogo de Tools

**`roll_fate_dice`** — Executa uma rolagem 4dF com modificadores. Parâmetros: `skillName`, `skillLevel`, `invokedAspectIds` (opcional), `bonus` (opcional), `type` (overcome/create_advantage/attack/defend), `opposition` (opcional), `description`. Lógica determinística: gera 4 valores entre -1 e +1 com PRNG seedado pelo `messageId`, soma com `skillLevel + bonus`, calcula outcome conforme tabela FATE. Persiste registro em `diceRolls`. Retorna resultado completo para o LLM continuar a narrativa.

**`invoke_aspect`** — Aplica invocação de Aspecto a uma rolagem em curso ou recém-feita. Parâmetros: `aspectId`, `targetRollId`, `effect` (`bonus_2` ou `reroll`), `payerId` (quem paga: jogador ou cena ou NPC), `usesFreeInvoke` (boolean). Lógica: se gratuita, decrementa `free_invokes` do aspecto; senão decrementa Ponto de Destino do payer. Aplica efeito à rolagem alvo. Persiste mudança.

**`compel_aspect`** — Inicia uma compulsão. Parâmetros: `aspectId`, `complication` (string descritiva). Lógica: cria registro pendente, retorna ao LLM um marcador de "aguardando decisão do jogador", a UI exibe modal, e a action principal pausa. Quando jogador decide via mutation separada, action retoma com o resultado (aceito ou recusado) e o LLM continua a narrativa de acordo. Implementação: a action pode usar `ctx.runQuery` em loop com timeout, ou padrão de "continuação agendada" via scheduler.

**`apply_stress`** — Aplica dano à pista de estresse. Parâmetros: `targetType` (`character` ou `npcId`), `track` (`physical` ou `mental`), `amount`. Lógica: marca caixas correspondentes; se não há caixa do valor disponível, retorna ao LLM o requisito de aplicar consequência via tool subsequente.

**`apply_consequence`** — Aplica consequência. Parâmetros: `targetType`, `severity` (`mild`/`moderate`/`severe`), `description`. Lógica: cria entrada em `consequences` do alvo. Severity define quantos pontos de estresse são absorvidos (2/4/6 respectivamente).

**`spend_fate_point`** — Decrementa Pontos de Destino do personagem. Parâmetros: `targetId` (geralmente o jogador), `reason`. Usado quando invocação de Aspecto exige pagamento e não tem free invoke.

**`award_fate_point`** — Concede Ponto de Destino. Parâmetros: `targetId`, `reason`. Usado tipicamente após o jogador aceitar uma compulsão.

**`add_scene_aspect`** — Cria Aspecto de cena. Parâmetros: `text`, `freeInvokes` (default 1). Tipicamente após sucesso em ação `create_advantage`.

**`change_scene`** — Encerra cena atual e cria nova. Parâmetros: `newSceneTitle`, `newSceneDescription`, `newLocationId` (opcional), `presentEntityIds`. Aciona resumo de cena anterior em background.

**`reveal_fact`** — Muda visibilidade de fato `hidden` ou `rumored` para `known`. Parâmetros: `factId`. Uso pelo GM quando narrativamente necessário e não há gatilho cabível. O system prompt instrui parcimônia.

**`reveal_entity`** — Análogo a `reveal_fact` mas para entidades.

### 8.2 Execução de Tools Durante Streaming

A action que orquestra a geração da resposta gerencia o ciclo completo. Em pseudocódigo:

```
loop:
  stream = openrouter.completion(model, messages, tools, stream=true)
  for chunk in stream:
    if chunk is text:
      append to message content via mutation
    if chunk is tool_call_start:
      pause UI indicator changes to "rolando dados..." or similar
    if chunk is tool_call_complete:
      result = execute_tool(name, params)
      append result to messages as tool_result
      append tool call summary to message content (visual block)
  if stream finished without pending tool:
    break
  else:
    continue loop with updated messages including tool results
```

O loop trata corretamente o caso de múltiplas tool calls em sequência (combate com várias rolagens, por exemplo).

### 8.3 Determinismo e Auditoria

Toda rolagem gera entrada em `diceRolls` com a seed exata usada. A seed é derivada do `messageId` concatenado com um contador local de rolagens dentro do turno. Reproduzir uma rolagem é trivial. Isso é importante por dois motivos: confiança do jogador (ele pode questionar e ver exatamente o que aconteceu) e debugging (testes podem rodar campanhas com seeds fixas).


---

## 9. Estratégia de IA e Prompts

### 9.1 Roteamento de Modelos

A estratégia segue o princípio de usar o modelo certo para cada tarefa, com todos os modelos sendo open-source e disponíveis via OpenRouter. A configuração padrão do produto é a seguinte.

Para geração narrativa (resposta do GM e geração de mundo), o modelo padrão é DeepSeek V3, escolhido pela qualidade criativa, suporte a contexto longo, e aderência decente a estruturas (incluindo tool calling). Alternativa configurável: Llama 3.3 70B Instruct.

Para tarefas utilitárias (classificação de gatilhos, validação anti-vazamento), o modelo é Llama 3.1 8B Instruct, suficiente para classificação binária ou top-K com prompt bem estruturado e ordens de magnitude mais barato.

Para tarefas de extração (extração de fatos novos pós-resposta) e resumo (resumo de cena), o modelo é Qwen 2.5 32B Instruct, ponto-doce de custo e qualidade para tarefas estruturadas que exigem compreensão semântica mas não criatividade.

Para resumo de arco e campanha, devido à importância da compressão semântica de longo alcance, usar DeepSeek V3 novamente.

Para embeddings, usar BAAI/bge-m3 (multilingual, 1024 dimensões), justificado pela necessidade de funcionar bem em português brasileiro.

Toda essa configuração é exposta no objeto `llmConfig` da campanha, permitindo que power users substituam por modelos proprietários (Claude, GPT-4, etc) via BYOK quando desejarem qualidade superior.

### 9.2 Estrutura do System Prompt do GM

O system prompt do GM tem entre 2.000 e 4.000 tokens e é majoritariamente estático por campanha (apenas `tone` e `premise` variam). Sua estrutura segue a ordem.

A primeira seção declara identidade e função: o LLM é um Mestre de RPG conduzindo uma campanha solo do jogador usando FATE Condensed. Estabelece a postura: parceiro narrativo, não assistente neutro.

A segunda seção lista princípios narrativos não-negociáveis: rigorosa separação WORLD_STATE/PLAYER_KNOWLEDGE, NPCs com motivações próprias, consequências persistentes, mostrar não contar.

A terceira seção é o resumo executivo das regras FATE Condensed: escala adjetiva, tipos de ação (overcome, create advantage, attack, defend), estresse e consequências, Aspectos e invocação, compelir, free invokes, Pontos de Destino. Aproximadamente 800 tokens, escrito como referência ágil ao invés do livro completo.

A quarta seção orienta uso de tools: quando rolar e quando não rolar, parcimônia em compelir e revelar, regras de uso de Pontos de Destino.

A quinta seção é o tom específico da campanha (variável): adjetivos descritivos do tom, exemplos de prosa-modelo se útil.

A sexta seção é a premissa específica da campanha (variável): contextualização do mundo no nível necessário para a geração.

### 9.3 Estrutura do Contexto Por Turno

Adicionado após o system prompt em cada turno. Aproximadamente 4.000-12.000 tokens variáveis. A ordem importa para atenção do modelo.

Primeiro vem a ficha do personagem em formato JSON compacto. Depois, o estado da cena atual (local, aspectos, NPCs presentes filtrados pela visibilidade). Então um bloco claramente marcado `<world_state_internal>` com fatos `hidden`/`rumored` relevantes recuperados, NPCs com seus segredos completos, e gatilhos próximos ao disparo. Logo após, bloco `<player_knowledge>` com fatos `known`, entidades conhecidas, sumários recuperados.

Em seguida, o histórico recente (últimas 15-20 mensagens em formato chat). Eventos disparados neste turno se houver, como bloco `<events_just_fired>` instruindo o GM a incorporar a revelação naturalmente. Por fim, a mensagem atual do jogador.

Imediatamente antes da mensagem do jogador, uma reafirmação sucinta da regra crítica: "Lembre: você só pode mencionar fatos em `<player_knowledge>`. Use `<world_state_internal>` apenas para coerência interna."

### 9.4 Prompts de Tarefas Utilitárias

Os prompts utilitários são curtos, focados, e forçam saída JSON via marcador explícito ou via JSON mode quando o modelo suporta.

**Classificação de gatilhos.** Prompt curto descrevendo a tarefa, listando os 10 candidatos com IDs e descrições, e pedindo retorno em JSON com `{ "ativados": [...], "raciocinio": "..." }`.

**Validação anti-vazamento.** Prompt apresentando a resposta gerada, listando fatos `hidden` relevantes, e pedindo retorno binário `{ "vazou": bool, "fatos": [...], "trechos": [...] }`.

**Extração de fatos novos.** Prompt apresentando a resposta gerada e pedindo extração de fatos persistíveis em formato `{ "facts": [{ "content": "...", "visibility": "...", "related_entities": [...] }] }`.

**Resumo de cena.** Prompt apresentando todas as mensagens da cena e pedindo resumo em prosa de 200-400 palavras destacando: ações principais do jogador, decisões importantes, fatos revelados, mudanças de estado importantes, mood emocional dominante.

### 9.5 Estratégias de Otimização de Custo

Cache de prompt para o system prompt fixo da campanha, ativado quando o provedor OpenRouter expõe o recurso.

Truncamento dinâmico do histórico recente: em campanhas de 100+ turnos, em vez de mandar 20 mensagens cruas, mandar 8 cruas + sumário compacto das 12 anteriores.

Tier-down opcional para cenas de transição: detectar via heurística (mensagem do jogador curta, sem oposição clara, sem invocação) e usar Qwen 32B em vez de DeepSeek V3 para a resposta. Não no MVP, mas registrado como otimização v1.

---

## 10. Roadmap

### 10.1 MVP (semanas 1-8)

O MVP é o produto mínimo que valida a tese central: arquitetura de memória + sistema de gatilhos vetoriais + mecânicas FATE produzem experiência narrativa coerente em campanhas de até 30 turnos.

Inclui: autenticação básica, criação de campanha (fluxo híbrido completo), interface de jogo com chat e ficha lateral, fluxo de turno completo com todos os 8 estágios, todas as tools FATE listadas em §8.1, cheat mode com edição de fatos/entidades/gatilhos, persistência completa, custo de turno dentro do alvo.

Não inclui: BYOK (apenas chave do sistema), tutorial de FATE, busca em histórico, exportação, modelos configuráveis na UI (apenas via banco), validação anti-vazamento por padrão (ligável manualmente para testes), múltiplos personagens.

Critério de saída: três campanhas de teste completas (uma one-shot, uma medium parcial, uma com 30+ turnos) sem regressões críticas em coerência.

### 10.2 v1 — Lançamento Público (semanas 9-16)

Adiciona o que falta para um produto público viável. BYOK com criptografia de chaves. Tutorial interativo de FATE Condensed. Busca textual em histórico. Configuração de modelos via UI. Validação anti-vazamento ligada por padrão com ajustes finos. Onboarding melhorado. Métricas de produto. Sistema básico de billing (créditos ou assinatura).

### 10.3 v2 — Expansão (3-6 meses pós-v1)

Importação de cenários FATE externos (Worlds of Adventure). Geração de imagens para NPCs e locais (DALL-E ou modelos open-source). Exportação de campanha para PDF/Markdown. Modo multiplayer experimental (party de até 4 jogadores). Mobile app via Expo (compartilhando lógica core).

### 10.4 v3+ — Visão Longa

Suporte a outros sistemas narrativos (Powered by the Apocalypse, Blades in the Dark). TTS para narração ambiente. Compartilhamento de campanhas como "ouvir podcast" — outros usuários acompanham campanha de outro de forma assíncrona. Marketplace de cenários criados pela comunidade. Integração com VTTs.

---

## 11. Métricas de Sucesso

### 11.1 Métricas de Produto

**Retenção D1, D7, D30.** Padrão da indústria. Alvo MVP: 40% D1, 20% D7, 10% D30. Alvo v1: 60/35/15.

**Conclusão de primeira campanha.** Percentual de usuários que completam (manualmente ou por arco) sua primeira campanha. Métrica-chave de engajamento profundo. Alvo v1: 25% dos usuários que iniciam uma campanha a concluem.

**Turnos por campanha.** Distribuição. Alvo: mediana > 20, P75 > 50.

**Coerência percebida.** NPS adaptado: ao final de cada sessão, perguntar "o GM lembrou e respeitou os fatos da campanha?" em escala 1-5. Alvo: média ≥ 4,2.

### 11.2 Métricas Técnicas

**Latência P95 do estágio 4.** Alvo: ≤ 8 segundos para primeiro token, ≤ 20 segundos para resposta completa simples.

**Taxa de vazamento detectado.** Percentual de turnos em que validação anti-vazamento detecta vazamento. Alvo: < 3%. Métrica de qualidade do prompt principal.

**Taxa de regeneração necessária.** Percentual de turnos que precisam ser regenerados. Alvo: < 5%.

**Custo médio por turno.** Em USD. Alvo MVP: ≤ $0.025. Alvo v1: ≤ $0.020 com otimizações.

**Taxa de erro de tool calling.** Percentual de tool calls malformadas que precisam fallback. Alvo: < 2%. Se ultrapassar, considerar fallback de marcadores em texto (plano B em §1).

### 11.3 Métricas de Negócio (pós-v1)

Conversão de free para paid, MRR, churn mensal, LTV, CAC. Definidos quando modelo de pricing for finalizado.

---

## 12. Riscos e Decisões Abertas

### 12.1 Riscos Técnicos

**Inconsistência de tool calling em modelos open-source.** Probabilidade média, impacto alto. Mitigação: testes empíricos cedo (sprint 1) com Llama 3.3 70B e DeepSeek V3 em cenários FATE reais. Plano B: fallback para marcadores especiais em texto que são parseados server-side. Plano C: rotear apenas a etapa de tool-heavy para Qwen 2.5 72B se este se mostrar mais consistente.

**Vazamento de fatos hidden mesmo com validação.** Probabilidade média, impacto alto. Mitigação: prompt principal extremamente claro com reforço imediatamente antes da mensagem do jogador, e validação dupla quando crítico. Aceitar que casos isolados ocorrerão e oferecer mecanismo de regeneração ao jogador.

**Custo escalando além do esperado.** Probabilidade baixa-média, impacto alto. Mitigação: alertas de custo por campanha, quotas configuráveis por usuário, otimizações de truncamento agressivo se necessário.

**Qualidade narrativa em modelos open-source insuficiente.** Probabilidade baixa-média, impacto crítico. Mitigação: testes A/B cedos comparando DeepSeek V3 vs Llama 3.3 vs Claude Sonnet em cenários idênticos. Se gap for muito grande, viabilizar BYOK com Sonnet desde o MVP e ajustar pricing.

**Performance de vector search em campanhas longas.** Probabilidade baixa, impacto médio. Mitigação: monitorar latência de busca em campanhas com 1.000+ vetores; Convex tem indexação otimizada mas vale benchmark cedo.

### 12.2 Riscos de Produto

**Aprendizado do FATE como barreira.** Jogadores novos em FATE podem se sentir perdidos. Mitigação: tutorial interativo em v1, e o GM IA pode ser instruído a explicar mecânicas inline na primeira sessão se detectar que o jogador é novato.

**Loop narrativo monótono.** Risco de o GM cair em padrões repetitivos em campanhas longas. Mitigação: variação no prompt baseada em mood detectado, incentivo via prompt para o GM "subverter expectativas" periodicamente, sumários de arco que reposicionam ritmo.

**Solo player sem grupo perde motivação.** Mitigação parcial: features comunitárias em v3 (compartilhamento assíncrono).

### 12.3 Decisões Abertas

Algumas decisões foram deliberadamente postergadas para serem tomadas com dados ou durante implementação.

**Modelo de monetização específico.** BYOK no MVP (custo zero para o produto), assinatura ou créditos a partir de v1. Decisão final depende de validação de uso e custo real.

**Limite de campanhas simultâneas no plano gratuito.** Sugestão inicial: 1 campanha ativa, ilimitadas arquivadas.

**Retenção de logs de inferência.** Sugestão inicial 30 dias, ajustável.

**Idioma do produto.** MVP em português brasileiro (jogador-alvo do criador). Internacionalização em v2+.

**Strategy de compartilhamento de chave do sistema.** Quando o usuário não tem BYOK, todas as chamadas usam chave compartilhada. Risco de abuso (rate limiting do OpenRouter atinge todos). Mitigação: quotas por usuário na camada Convex.

---

## 13. Estrutura do Repositório (referência)

Sugestão de organização do código, alinhada ao padrão monorepo pnpm que o autor já usa.

```
mythwright/
├── apps/
│   └── web/                    # React + Vite app
│       ├── src/
│       │   ├── routes/         # rotas: dashboard, campaign, admin
│       │   ├── features/       # módulos: campaign-creation, gameplay, cheat-mode
│       │   ├── components/     # UI shared
│       │   ├── lib/            # utilidades client-side
│       │   └── styles/
│       └── package.json
├── packages/
│   ├── shared/                 # tipos compartilhados, validators
│   └── fate-engine/            # lógica determinística FATE (rolagens, outcomes)
├── convex/                     # backend Convex
│   ├── schema.ts
│   ├── queries/
│   ├── mutations/
│   ├── actions/                # turn processing, llm calls
│   ├── prompts/                # templates de prompt versionados
│   └── lib/
├── package.json
└── pnpm-workspace.yaml
```

A separação de `fate-engine` em package próprio permite testar a lógica determinística isoladamente e potencialmente reutilizar em mobile/CLI futuro.

---

## 14. Próximos Passos Imediatos

A partir deste PRD, os próximos artefatos a produzir, em ordem sugerida:

1. **Schema Convex implementado** em `convex/schema.ts` — tradução literal da seção 5.4.
2. **Prompts versionados** em `convex/prompts/` — system prompt do GM, prompts utilitários, todos com variáveis bem delimitadas.
3. **POC do fluxo de turno** — implementação enxuta dos 8 estágios em uma única action, sem UI sofisticada, para validar viabilidade técnica e qualidade narrativa.
4. **Teste empírico de tool calling** — campanha de teste com cenário FATE clássico (combate, investigação, social) usando DeepSeek V3 e Llama 3.3 70B, medindo aderência a tools.
5. **Design system mínimo** — paleta, tipografia, componentes core seguindo os princípios visuais da §7.1.
6. **Implementação fase 1 (MVP)** — sprint planning baseado nas seções 3 e 6.

---

**Fim do PRD.**

