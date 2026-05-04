import { QueryCtx, MutationCtx, internalQuery } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { decryptValue } from "./crypto";

export class OpenRouterKeyMissingError extends Error {
  constructor() {
    super("openrouter_key_missing");
    this.name = "OpenRouterKeyMissingError";
  }
}

/**
 * Retorna a chave OpenRouter descriptografada do usuario,
 * ou null se nao houver chave salva.
 * Lanca erro se o usuario nao existir.
 */
export async function getDecryptedOpenRouterKey(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<string | null> {
  const user = await ctx.db.get(userId);
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }
  if (!user.encryptedOpenRouterKey) {
    return null;
  }
  return decryptValue(user.encryptedOpenRouterKey);
}

/**
 * Resolve a chave OpenRouter para uso numa action:
 * 1. Tenta a chave do usuario (descriptografada)
 * 2. Fallback para process.env.OPENROUTER_API_KEY (dev/test)
 * 3. Lanca OpenRouterKeyMissingError se nenhuma disponivel
 */
export async function resolveOpenRouterKey(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<string> {
  const userKey = await getDecryptedOpenRouterKey(ctx, userId);
  if (userKey) return userKey;

  const envKey = process.env.OPENROUTER_API_KEY;
  if (envKey) return envKey;

  throw new OpenRouterKeyMissingError();
}

export const resolveOpenRouterKeyInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<string> => {
    return resolveOpenRouterKey(ctx, args.userId);
  },
});
