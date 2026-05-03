import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const ANTILEAK_MODEL = "openai/gpt-4o-mini";

const EMPTY_RESULT = { vazou: false, facts: [] as string[], trechos: [] as string[] };

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

export const getMessage = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    return message?.content ?? null;
  },
});

export const validateAntiLeak = internalAction({
  args: {
    messageId: v.id("messages"),
    hiddenFacts: v.array(v.object({ id: v.string(), content: v.string() })),
  },
  handler: async (ctx, args) => {
    const messageContent = await ctx.runQuery(internal.prompts.antiLeak.getMessage, {
      messageId: args.messageId,
    });

    const prompt = buildAntiLeakPrompt(messageContent ?? "", args.hiddenFacts);

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANTILEAK_MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const rawContent = data.choices[0].message.content;

    const result = parseAntiLeakResponse(rawContent);

    if (result.parseError) {
      console.error("validateAntiLeak: parse error, rawContent:", rawContent);
      return EMPTY_RESULT;
    }

    return { vazou: result.vazou, facts: result.facts, trechos: result.trechos };
  },
});

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
