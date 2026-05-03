export interface TriggerCandidate {
  id: string;
  description: string;
  scope: string;
}

export function buildTriggerClassifierPrompt(
  playerMessage: string,
  sceneSummary: string,
  candidates: TriggerCandidate[],
): string {
  const candidatesBlock = candidates
    .map((c) => `[${c.id}] (escopo: ${c.scope})\n"${c.description}"`)
    .join("\n\n");

  return `Você é um classificador de gatilhos narrativos em um RPG. Sua tarefa é determinar quais gatilhos foram ativados pela mensagem do jogador.

CONTEXTO DA CENA:
${sceneSummary}

MENSAGEM DO JOGADOR:
"${playerMessage}"

GATILHOS CANDIDATOS:
${candidatesBlock}

INSTRUÇÕES:

Para cada gatilho, avalie:
1. A mensagem do jogador descreve uma ação, fala ou intenção que se alinha com a descrição do gatilho?
2. A ativação faz sentido na cena atual?
3. Não basta que o tópico seja relacionado — o jogador deve realmente ter feito ou tentado o que o gatilho descreve.

Responda APENAS com JSON no formato:

{
  "ativados": ["trigger_id_1", "trigger_id_2"],
  "raciocinio": "explicação breve por gatilho ativado, em 1 frase cada"
}

Se nenhum gatilho ativou, retorne:

{
  "ativados": [],
  "raciocinio": "nenhum gatilho cabível"
}

Seja CONSERVADOR. Em caso de dúvida, não ative.`;
}

export function parseTriggerClassifierResponse(raw: string): {
  ativados: string[];
  raciocinio: string;
} {
  try {
    const parsed = JSON.parse(raw);
    return {
      ativados: Array.isArray(parsed.ativados) ? parsed.ativados : [],
      raciocinio: typeof parsed.raciocinio === "string" ? parsed.raciocinio : "",
    };
  } catch {
    return { ativados: [], raciocinio: "" };
  }
}
