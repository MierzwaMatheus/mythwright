import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

export async function seedReadyCampaign(
  t: ReturnType<typeof convexTest>,
  identity: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  args: {
    name: string;
    premise: string;
    tone: string;
    expectedDuration: string;
  },
): Promise<Id<"campaigns">> {
  const campaignId = (await identity.mutation(
    api.campaigns.createCampaign,
    args,
  )) as Id<"campaigns">;
  await t.run(async (ctx) => {
    await ctx.db.patch(campaignId, { setupStatus: "ready" });
  });
  return campaignId;
}
