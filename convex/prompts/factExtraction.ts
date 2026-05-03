import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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

export function deduplicateFacts<T extends { content: string }>(
  newFacts: Array<T>,
  existingFacts: Array<{ content: string }>
): Array<T> {
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

export const getMessageContent = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    return message?.content ?? null;
  },
});

export const extractAndPersistFacts = internalAction({
  args: {
    messageId: v.id("messages"),
    campaignId: v.id("campaigns"),
  },
  handler: async (ctx, args): Promise<Id<"facts">[]> => {
    const [gmResponse, existingFacts, llmConfig] = await Promise.all([
      ctx.runQuery(internal.prompts.factExtraction.getMessageContent, { messageId: args.messageId }),
      ctx.runQuery(internal.facts.getFactsByCampaignInternal, { campaignId: args.campaignId }),
      ctx.runQuery(internal.lib.llmConfig.getLlmConfigInternal, { campaignId: args.campaignId }),
    ]);

    const prompt = buildFactExtractionPrompt(gmResponse ?? "", existingFacts);

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: llmConfig.extractionModel,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const rawContent = data.choices[0].message.content;

    const parsedFacts = parseFactExtractionResponse(rawContent);
    const newFacts = deduplicateFacts(parsedFacts, existingFacts);

    const factIds: Id<"facts">[] = [];
    for (const fact of newFacts) {
      const factId: Id<"facts"> = await ctx.runMutation(
        internal.facts.createFactInternal,
        {
          campaignId: args.campaignId,
          content: fact.content,
          visibility: fact.visibility,
        },
      );
      factIds.push(factId);
    }

    return factIds;
  },
});
