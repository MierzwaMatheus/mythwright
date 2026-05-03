const VALID_VISIBILITIES = new Set(["hidden", "rumored", "known"]);

function normalize(content: string): string {
  return content.toLowerCase().replace(/[^\w\s]/g, "");
}

function tokenize(content: string): Set<string> {
  return new Set(normalize(content).split(/\s+/).filter(Boolean));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((w) => b.has(w)));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  return intersection.size / union.size;
}

export function deduplicateFacts(
  newFacts: Array<{ content: string }>,
  existingFacts: Array<{ content: string }>
): Array<{ content: string }> {
  const existingTokens = existingFacts.map((f) => tokenize(f.content));

  return newFacts.filter((newFact) => {
    const newTokens = tokenize(newFact.content);
    return !existingTokens.some((et) => jaccardSimilarity(newTokens, et) > 0.8);
  });
}

export function parseFactExtractionResponse(rawResponse: string): Array<{
  content: string;
  visibility: "hidden" | "rumored" | "known";
  relatedEntityIds: string[];
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    console.warn("parseFactExtractionResponse: JSON malformado, retornando []");
    return [];
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).facts)
  ) {
    console.warn("parseFactExtractionResponse: campo 'facts' ausente ou inválido, retornando []");
    return [];
  }

  const facts = (parsed as Record<string, unknown>).facts as unknown[];

  return facts.flatMap((fact) => {
    if (typeof fact !== "object" || fact === null) {
      console.warn("parseFactExtractionResponse: fato inválido descartado", fact);
      return [];
    }
    const f = fact as Record<string, unknown>;

    if (typeof f.content !== "string" || f.content === "") {
      console.warn("parseFactExtractionResponse: content inválido descartado", fact);
      return [];
    }
    if (!VALID_VISIBILITIES.has(f.visibility as string)) {
      console.warn("parseFactExtractionResponse: visibility inválida descartada", fact);
      return [];
    }
    if (!Array.isArray(f.relatedEntityIds)) {
      console.warn("parseFactExtractionResponse: relatedEntityIds inválido descartado", fact);
      return [];
    }

    return [
      {
        content: f.content,
        visibility: f.visibility as "hidden" | "rumored" | "known",
        relatedEntityIds: f.relatedEntityIds as string[],
      },
    ];
  });
}

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
