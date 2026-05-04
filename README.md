# Mythwright

> Mestre de RPG por IA para campanhas narrativas solo, baseado nas regras do FATE Condensed.

## O que é este projeto?

Mythwright é uma aplicação web single-player que simula um Mestre de RPG com inteligência artificial. O sistema usa as regras do **FATE Condensed** como base mecânica e narrativa.

O diferencial técnico central é uma **arquitetura de memória em camadas** que resolve o problema de coerência em campanhas longas. O Mestre IA distingue rigorosamente o que existe no mundo do que o personagem do jogador conhece. Isso evita o problema clássico de "a IA esqueceu o que aconteceu" ou "revelou um segredo antes da hora".

### Para quem é útil?

- **Solo roleplayers** que querem jogar RPG narrativo sem depender de grupo ou horários fixos.
- **Mestres humanos** que querem testar cenários, NPCs e enredos antes de levar à mesa real.
- Desenvolvedores interessados em arquiteturas de memória para agentes de IA.

### O que o sistema oferece?

- Campanhas completas com começo, meio e fim coerentes.
- Mecânicas FATE integrais: rolagens de dados, invocação de Aspectos, compelir, estresse, consequências e Pontos de Destino.
- Sistema de gatilhos vetoriais que revela segredos com intencionalidade narrativa.
- Modo *cheat* para inspecionar e editar o estado do mundo durante o jogo.
- Validação automática que impede vazamento de fatos secretos ao jogador.
- Resumos hierárquicos que mantêm coerência em campanhas de até 2.000 turnos.

> [!NOTE]
> O produto está em desenvolvimento ativo (fase MVP). O idioma do produto é **português brasileiro**. Internacionalização está prevista para v2+.

---

## Instalação

### Pré-requisitos

| Ferramenta | Versão mínima |
|---|---|
| Node.js | 20.x ou superior |
| npm | 10.x ou superior |
| Conta Convex | gratuita em [convex.dev](https://convex.dev) |
| Chave OpenRouter | gratuita ou paga em [openrouter.ai](https://openrouter.ai) |

### Passo a passo

1. Clone o repositório e instale as dependências.

```bash
git clone <url-do-repositorio>
cd mythwright
npm install
```

2. Configure as variáveis de ambiente do Convex.

Crie o arquivo `.env.local` na raiz do projeto com as seguintes variáveis:

```bash
CONVEX_DEPLOYMENT=<seu-deployment-convex>
VITE_CONVEX_URL=<url-do-seu-deployment-convex>
```

3. Inicialize o backend Convex.

```bash
npx convex dev
```

Esse comando sincroniza o schema e as funções Convex com o deployment configurado.

4. Em outro terminal, inicie o servidor de desenvolvimento do frontend.

```bash
npm run dev
```

A aplicação estará disponível em `http://localhost:5173`.

> [!IMPORTANT]
> A chave do OpenRouter é configurada na interface do próprio Mythwright, nas configurações da conta. Não é necessário incluí-la no `.env.local`.

---

## Como Usar

### Criar uma campanha

1. Crie sua conta ou faça login na aplicação.
2. Na tela inicial, clique em **Nova Campanha**.
3. Preencha a premissa, o tom e a duração esperada.
4. O sistema gera automaticamente NPCs, locais, fatos e gatilhos narrativos.
5. Revise e edite o que quiser antes de iniciar.
6. Crie ou gere seu personagem FATE.
7. Clique em **Começar Campanha**.

### Jogar

Após iniciar, o Mestre IA narra a cena de abertura. Você responde com texto livre. Quando uma ação exige teste, o sistema rola os dados automaticamente e exibe o resultado inline na conversa.

```
Jogador: Tento arrombar a porta da taverna antes que os guardas cheguem.

[Mestre IA]
A madeira cede com um estrondo abafado — o trancado estava frouxo.
[Furtividade +2 | 4dF: +1 -1 +1 +1 = +2 | Total: +4 — Sucesso com Estilo]
Você entra antes que as tochas dos guardas dobrem a esquina...
```

> [!TIP]
> Fique de olho nos blocos de rolagem que aparecem inline. Eles mostram a perícia usada, os modificadores e o resultado final. Todo resultado é determinístico e auditável — você pode verificar exatamente o que foi rolado.

### Mecânicas FATE disponíveis

O Mestre IA invoca as seguintes ferramentas durante a narração:

| Mecânica | O que faz |
|---|---|
| `roll_fate_dice` | Rola 4dF com modificadores de perícia |
| `invoke_aspect` | Aplica invocação de Aspecto a uma rolagem |
| `compel_aspect` | Propõe uma complicação ao jogador; pausa a resposta até a decisão |
| `apply_stress` | Aplica dano à pista de estresse do alvo |
| `apply_consequence` | Registra consequência de derrota |
| `spend_fate_point` | Decrementa Ponto de Destino |
| `award_fate_point` | Concede Ponto de Destino ao aceitar uma compulsão |
| `add_scene_aspect` | Cria Aspecto de cena |
| `change_scene` | Encerra a cena atual e cria uma nova |
| `reveal_fact` | Muda a visibilidade de um fato de `hidden` para `known` |

### Modo Cheat

Ative o **Cheat Mode** nas configurações da campanha para acessar a rota `/campaigns/:id/admin`. Lá você pode:

- Ver todos os fatos do mundo, incluindo os secretos.
- Editar entidades, gatilhos e fatos manualmente.
- Forçar o disparo de um gatilho sem esperar a condição narrativa.
- Inserir anotações pessoais na linha do tempo.

> [!WARNING]
> Editar fatos e gatilhos no Cheat Mode altera o estado real do mundo. Mudanças refletem imediatamente na próxima resposta do Mestre IA.

---

## Configuração

### Modelos de LLM

Cada campanha tem um objeto `llmConfig` que define qual modelo usar em cada tarefa. A configuração padrão é a seguinte:

| Tarefa | Modelo padrão |
|---|---|
| Geração narrativa (resposta do GM) | DeepSeek V3 |
| Classificação de gatilhos | Llama 3.1 8B Instruct |
| Extração de fatos | Qwen 2.5 32B Instruct |
| Resumo de cena e arco | Qwen 2.5 32B Instruct |
| Resumo de campanha | DeepSeek V3 |
| Embeddings | BAAI/bge-m3 (1024 dimensões) |

Todos os modelos são *open-source* e roteados via [OpenRouter](https://openrouter.ai). Usuários avançados podem substituir qualquer modelo nas configurações da campanha.

### Campos de configuração da campanha

| Campo | Tipo | Descrição |
|---|---|---|
| `cheatModeEnabled` | boolean | Ativa a rota `/admin` para edição do estado do mundo |
| `antiLeakValidationEnabled` | boolean | Ativa validação pós-geração contra vazamento de fatos secretos |
| `llmConfig.narrativeModel` | string | Sobrescreve o modelo narrativo |
| `llmConfig.utilityModel` | string | Sobrescreve o modelo utilitário |
| `llmConfig.extractionModel` | string | Sobrescreve o modelo de extração |
| `llmConfig.embeddingModel` | string | Sobrescreve o modelo de embeddings |

---

## Estrutura do Projeto

```
mythwright/
├── convex/              # Backend Convex: schema, funções e testes
│   ├── schema.ts        # Definição completa do banco de dados
│   ├── processTurn.ts   # Orquestração dos 8 estágios do turno de jogo
│   ├── campaigns.ts     # Lifecycle de campanhas
│   ├── characters.ts    # Ficha FATE do personagem
│   ├── entities.ts      # NPCs, locais, facções, itens e conceitos
│   ├── facts.ts         # Fatos com visibilidade (hidden/rumored/known)
│   ├── triggers.ts      # Gatilhos narrativos condição-efeito
│   ├── summaries.ts     # Resumos hierárquicos de cena/arco/campanha
│   ├── lib/             # Utilitários: contextBuilder, embedding, vectorSearch
│   ├── prompts/         # Templates de prompt versionados do Mestre IA
│   └── tools/           # Implementação das tools FATE (rolagens, compelir etc.)
├── packages/
│   └── fate-engine/     # Lógica determinística FATE isolada (rolagens, outcomes)
├── src/                 # Frontend React + Vite
└── docs/                # PRD, arquitetura técnica e planos de migração
```

O pacote `fate-engine` é mantido separado do backend Convex por três razões: testabilidade isolada, reusabilidade futura em mobile ou CLI, e garantia de que rolagens de dados nunca são afetadas por mudanças no backend.

---

## Testes

O projeto usa [Vitest](https://vitest.dev) com a biblioteca `convex-test` para testes unitários e de integração das funções Convex.

Para rodar todos os testes uma vez:

```bash
npm test
```

Para rodar em modo *watch* durante o desenvolvimento:

```bash
npm run test:watch
```

> [!NOTE]
> Os testes cobrem a lógica do backend Convex (funções de turno, extração de fatos, classificação de gatilhos) e a `fate-engine` pura. Testes de interface não estão incluídos no MVP.

---

## Como Contribuir

Este é um projeto pessoal em desenvolvimento ativo. Se quiser contribuir:

1. Faça um *fork* do repositório.
2. Crie um branch com o nome da sua mudança: `git checkout -b feat/nome-da-feature`.
3. Faça suas alterações. Para mudanças no backend Convex, leia `convex/_generated/ai/guidelines.md` antes de começar.
4. Escreva ou atualize os testes relevantes.
5. Abra um Pull Request descrevendo o que foi feito e por quê.

### Ambiente de desenvolvimento

Você precisa de uma conta Convex ativa e de uma chave OpenRouter para executar o projeto localmente. Ambas têm planos gratuitos disponíveis.

> [!IMPORTANT]
> Todo código novo no diretório `convex/` deve seguir as diretrizes em `convex/_generated/ai/guidelines.md`. Esse arquivo contém regras específicas da plataforma Convex que sobrescrevem convenções gerais de desenvolvimento.

---

## Licença

Este projeto é privado e de uso pessoal. Nenhuma licença de código aberto é aplicada no momento.
