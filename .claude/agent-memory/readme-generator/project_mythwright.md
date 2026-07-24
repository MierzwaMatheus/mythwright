---
name: Mythwright — visão geral do projeto
description: Stack, propósito e estrutura do projeto Mythwright para contexto em futuras gerações de documentação
type: project
---

Mythwright é uma aplicação web de RPG narrativo solo com Mestre por IA, baseada em FATE Condensed. O diferencial é uma arquitetura de memória em camadas que separa WORLD_STATE de PLAYER_KNOWLEDGE.

**Stack:** React 19 + TypeScript + Vite (frontend), Convex (backend completo: DB, auth, vector search, jobs), OpenRouter (gateway LLM), BAAI/bge-m3 (embeddings 1024d).

**Pacotes internos:** `packages/fate-engine` — lógica determinística FATE isolada do Convex (rolagens, outcomes). Mantido separado para testabilidade.

**Modelos LLM (por tarefa):**
- Narrativa: DeepSeek V3
- Utilitário/classificação: Llama 3.1 8B
- Extração/resumo: Qwen 2.5 32B
- Campanha: DeepSeek V3

**Why:** MVP em PT-BR, idioma do público-alvo do criador. Internacionalização em v2+.

**How to apply:** Ao documentar ou descrever o projeto, enfatizar a arquitetura de memória e a separação WORLD_STATE/PLAYER_KNOWLEDGE como o diferencial central. Não traduzir: FATE, Aspectos, Pontos de Destino (termos estabelecidos na comunidade BR de RPG).
