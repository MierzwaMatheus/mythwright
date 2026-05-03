export function buildSceneSummarizerPrompt(
  sceneTitle: string,
  sceneDescription: string,
  messagesBlock: string,
): string {
  return `Você é um cronista de RPG. Sua tarefa é resumir a cena abaixo de forma compacta mas informativa, para servir como memória de longo prazo do GM.

CENA: ${sceneTitle}

DESCRIÇÃO INICIAL:
${sceneDescription}

MENSAGENS:
${messagesBlock}

INSTRUÇÕES:

Produza um resumo em prosa de 200-400 palavras, organizado em 4 parágrafos:

1. **Contexto e abertura** — onde, quando, com quem; estado inicial
2. **Ações principais do jogador** — o que ele decidiu, tentou, conquistou
3. **Eventos e revelações** — o que mudou no mundo, o que ele descobriu
4. **Estado final e implicações** — como a cena termina, o que fica em aberto

Seja específico em nomes, locais, e fatos concretos. Evite linguagem floreada ou interpretativa — escreva como um arquivo de referência, não como crônica literária.

NÃO inclua:
- Diálogos verbatim (resuma o teor)
- Descrições atmosféricas (foque no que importa para continuidade)
- Especulações sobre o futuro

Responda APENAS com o texto do resumo, sem títulos de seção, sem cabeçalho, sem JSON.`;
}

export function parseSceneSummarizerResponse(raw: string): string {
  return raw;
}
