export function buildFactExtractionPrompt(
  gmResponse: string,
  existingFacts: Array<{ content: string }>
): string {
  const factsBlock =
    existingFacts.length > 0
      ? existingFacts.map((f) => `- ${f.content}`).join("\n")
      : "(nenhum fato registrado ainda)";

  return `Você é um extrator de fatos narrativos. Analise a resposta do GM abaixo e identifique novos fatos relevantes sobre o mundo, personagens ou eventos.

RESPOSTA DO GM:
${gmResponse}

FATOS JÁ EXISTENTES (NÃO recrie estes fatos — ignore-os):
${factsBlock}

Extraia apenas fatos NOVOS que não estejam na lista acima.

Responda APENAS com um JSON no seguinte formato:
{ "facts": [{ "content": string, "visibility": "hidden" | "rumored" | "known", "relatedEntityIds": string[] }] }

- "content": descrição do fato extraído
- "visibility": nível de visibilidade do fato ("hidden" = secreto, "rumored" = rumor, "known" = público)
- "relatedEntityIds": IDs das entidades (personagens, locais, itens) relacionadas ao fato`;
}
