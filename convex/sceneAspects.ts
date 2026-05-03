import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";

export const addSceneAspect = mutation({
  args: {
    sceneId: v.id("scenes"),
    text: v.string(),
    freeInvokes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await getAuthenticatedUser(ctx);

    const scene = await ctx.db.get(args.sceneId);
    if (!scene) {
      throw new ConvexError("Scene not found");
    }
    if (scene.status !== "active") {
      throw new ConvexError("Scene is not active");
    }

    return await ctx.db.insert("sceneAspects", {
      sceneId: args.sceneId,
      text: args.text,
      freeInvokes: args.freeInvokes ?? 1,
    });
  },
});
