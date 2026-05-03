type AntiLeakResult = {
  vazou: boolean;
  facts: string[];
  trechos: string[];
  parseError?: boolean;
};

function parseErrorResult(): AntiLeakResult {
  return { vazou: false, facts: [], trechos: [], parseError: true };
}

export function parseAntiLeakResponse(rawResponse: string): AntiLeakResult {
  if (!rawResponse) return parseErrorResult();

  try {
    const parsed = JSON.parse(rawResponse);
    return { vazou: parsed.vazou, facts: parsed.facts, trechos: parsed.trechos };
  } catch {
    return parseErrorResult();
  }
}

function formatHiddenFacts(
  hiddenFacts: Array<{ id: string; content: string }>
): string {
  return hiddenFacts.map((f) => `[${f.id}] ${f.content}`).join("\n");
}

export function buildAntiLeakPrompt(
  gmResponse: string,
  hiddenFacts: Array<{ id: string; content: string }>
): string {
  const factsBlock = formatHiddenFacts(hiddenFacts);

  return `Você é um verificador de segurança narrativa. Analise a resposta do GM abaixo e verifique se algum fato secreto foi revelado.

RESPOSTA DO GM:
${gmResponse}

FATOS SECRETOS (não devem ser revelados):
${factsBlock}

Responda APENAS com um JSON no seguinte formato:
{ "vazou": bool, "facts": string[], "trechos": string[] }

- "vazou": true se algum fato secreto foi revelado, false caso contrário
- "facts": array com os IDs dos fatos que vazaram (ex: ["fact_001"])
- "trechos": array com os trechos exatos da resposta do GM que revelaram os fatos`;
}
