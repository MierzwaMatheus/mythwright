export function buildArcSummarizerPrompt(
  campaignPremise: string,
  sceneSummariesBlock: string,
): string {
  return `Você é o cronista-mor de uma campanha de RPG. Sua tarefa é destilar um arco narrativo a partir dos resumos de cenas individuais abaixo.

PREMISSA DA CAMPANHA:
${campaignPremise}

RESUMOS DE CENAS DESTE ARCO (em ordem cronológica):

${sceneSummariesBlock}

INSTRUÇÕES:

Produza um resumo de arco em 300-500 palavras, organizado em 5 parágrafos:

1. **Tensão central** — qual é a pergunta narrativa ou conflito que define este arco
2. **Trajetória do protagonista** — como ele entrou, o que mudou nele, onde está
3. **Marcos do mundo** — eventos que mudaram o mundo de forma persistente
4. **Relações desenvolvidas** — quais NPCs entraram em órbita, em que termos
5. **Linhas em aberto** — o que está suspenso, o que pode voltar a importar

Foque em CONTINUIDADE — o que é importante lembrar daqui pra frente. Detalhes táticos das cenas podem ser perdidos; o que precisa sobreviver é a transformação do mundo e dos relacionamentos.

Responda APENAS com o texto do resumo, em prosa contínua, sem títulos de seção.`;
}

export function parseArcSummarizerResponse(raw: string): string {
  return raw;
}
