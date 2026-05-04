import { internalAction, ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { vectorSearch } from "./vectorSearch";
import { internal } from "../_generated/api";

export type SemanticContext = {
  facts: Array<{ _id: Id<"facts">; content: string; visibility: "hidden" | "rumored" | "known" }>;
  entities: Array<{ _id: Id<"entities">; name: string; description: string; visibility: "hidden" | "rumored" | "known"; type: string }>;
  summaries: Array<{ _id: Id<"summaries">; content: string; level: string }>;
};

type Limits = {
  facts?: number;
  entities?: number;
  summaries?: number;
};

export async function retrieveSemanticContext(
  ctx: ActionCtx,
  args: {
    campaignId: Id<"campaigns">;
    queryEmbedding: number[];
    limits?: Limits;
  }
): Promise<SemanticContext> {
  const { campaignId, queryEmbedding, limits = {} } = args;
  const kFacts = limits.facts ?? 5;
  const kEntities = limits.entities ?? 5;
  const kSummaries = limits.summaries ?? 3;

  // Vector search filtra por campaignId; post-filter por visibility/level em memória
  const [factResults, entityResults, summaryResults] = await Promise.all([
    vectorSearch(ctx, "facts", "by_embedding", queryEmbedding, { campaignId }, kFacts * 3),
    vectorSearch(ctx, "entities", "by_embedding", queryEmbedding, { campaignId }, kEntities * 3),
    vectorSearch(ctx, "summaries", "by_embedding", queryEmbedding, { campaignId }, kSummaries * 3),
  ]);

  const factIds = factResults.slice(0, kFacts).map((r) => r._id as Id<"facts">);
  const entityIds = entityResults.slice(0, kEntities).map((r) => r._id as Id<"entities">);
  const summaryIds = summaryResults.slice(0, kSummaries).map((r) => r._id as Id<"summaries">);

  const [factDocs, entityDocs, summaryDocs] = await Promise.all([
    Promise.all(factIds.map((id) => ctx.runQuery(internal.facts.getByIdInternal, { factId: id }))),
    Promise.all(entityIds.map((id) => ctx.runQuery(internal.entities.getByIdInternal, { entityId: id }))),
    Promise.all(summaryIds.map((id) => ctx.runQuery(internal.summaries.getByIdInternal, { summaryId: id }))),
  ]);

  const facts = factDocs
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .filter((d) => d.visibility === "known" || d.visibility === "rumored")
    .map((d) => ({ _id: d._id, content: d.content, visibility: d.visibility as "hidden" | "rumored" | "known" }));

  const entities = entityDocs
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .filter((d) => d.visibility === "known" || d.visibility === "rumored")
    .map((d) => ({ _id: d._id, name: d.name, description: d.description, visibility: d.visibility as "hidden" | "rumored" | "known", type: d.type }));

  const summaries = summaryDocs
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .filter((d) => d.level === "scene" || d.level === "arc")
    .map((d) => ({ _id: d._id, content: d.content, level: d.level }));

  return { facts, entities, summaries };
}

export const retrieveSemanticContextAction = internalAction({
  args: {
    campaignId: v.id("campaigns"),
    queryEmbedding: v.array(v.float64()),
    limits: v.optional(v.object({
      facts: v.optional(v.number()),
      entities: v.optional(v.number()),
      summaries: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args): Promise<SemanticContext> => {
    return await retrieveSemanticContext(ctx, args);
  },
});
