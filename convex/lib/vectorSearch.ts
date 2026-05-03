import { ActionCtx } from "../_generated/server";

export async function vectorSearch(
  ctx: ActionCtx,
  table: string,
  indexName: string,
  queryEmbedding: number[],
  filters: Record<string, string | number | boolean>,
  k: number,
): Promise<Array<{ _id: string; _score: number }>> {
  const filterKeys = Object.keys(filters);

  const results = await ctx.vectorSearch(table as any, indexName as any, {
    vector: queryEmbedding,
    limit: k,
    filter: filterKeys.length > 0
      ? (q: any) => {
          const conditions = filterKeys.map((key) => q.eq(key, filters[key]));
          return conditions.length === 1 ? conditions[0] : q.and(...conditions);
        }
      : undefined,
  });

  return results as Array<{ _id: string; _score: number }>;
}
