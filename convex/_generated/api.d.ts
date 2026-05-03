/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aspectInvocations from "../aspectInvocations.js";
import type * as campaigns from "../campaigns.js";
import type * as characters from "../characters.js";
import type * as classifyTriggers from "../classifyTriggers.js";
import type * as compels from "../compels.js";
import type * as consequences from "../consequences.js";
import type * as embedding from "../embedding.js";
import type * as entities from "../entities.js";
import type * as facts from "../facts.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_contextBuilder from "../lib/contextBuilder.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_embedding from "../lib/embedding.js";
import type * as lib_llmConfig from "../lib/llmConfig.js";
import type * as lib_tokenCounter from "../lib/tokenCounter.js";
import type * as lib_vectorSearch from "../lib/vectorSearch.js";
import type * as messages from "../messages.js";
import type * as processTurn from "../processTurn.js";
import type * as processTurnFull from "../processTurnFull.js";
import type * as prompts_antiLeak from "../prompts/antiLeak.js";
import type * as prompts_arcSummarizer from "../prompts/arcSummarizer.js";
import type * as prompts_factExtraction from "../prompts/factExtraction.js";
import type * as prompts_gmSystemPrompt from "../prompts/gmSystemPrompt.js";
import type * as prompts_sceneSummarizer from "../prompts/sceneSummarizer.js";
import type * as prompts_triggerClassifier from "../prompts/triggerClassifier.js";
import type * as sceneAspects from "../sceneAspects.js";
import type * as scenes from "../scenes.js";
import type * as stress from "../stress.js";
import type * as summaries from "../summaries.js";
import type * as summarizeArc from "../summarizeArc.js";
import type * as summarizeScene from "../summarizeScene.js";
import type * as tools_catalog from "../tools/catalog.js";
import type * as tools_executor from "../tools/executor.js";
import type * as tools_rollFateDice from "../tools/rollFateDice.js";
import type * as triggers from "../triggers.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aspectInvocations: typeof aspectInvocations;
  campaigns: typeof campaigns;
  characters: typeof characters;
  classifyTriggers: typeof classifyTriggers;
  compels: typeof compels;
  consequences: typeof consequences;
  embedding: typeof embedding;
  entities: typeof entities;
  facts: typeof facts;
  "lib/auth": typeof lib_auth;
  "lib/contextBuilder": typeof lib_contextBuilder;
  "lib/crypto": typeof lib_crypto;
  "lib/embedding": typeof lib_embedding;
  "lib/llmConfig": typeof lib_llmConfig;
  "lib/tokenCounter": typeof lib_tokenCounter;
  "lib/vectorSearch": typeof lib_vectorSearch;
  messages: typeof messages;
  processTurn: typeof processTurn;
  processTurnFull: typeof processTurnFull;
  "prompts/antiLeak": typeof prompts_antiLeak;
  "prompts/arcSummarizer": typeof prompts_arcSummarizer;
  "prompts/factExtraction": typeof prompts_factExtraction;
  "prompts/gmSystemPrompt": typeof prompts_gmSystemPrompt;
  "prompts/sceneSummarizer": typeof prompts_sceneSummarizer;
  "prompts/triggerClassifier": typeof prompts_triggerClassifier;
  sceneAspects: typeof sceneAspects;
  scenes: typeof scenes;
  stress: typeof stress;
  summaries: typeof summaries;
  summarizeArc: typeof summarizeArc;
  summarizeScene: typeof summarizeScene;
  "tools/catalog": typeof tools_catalog;
  "tools/executor": typeof tools_executor;
  "tools/rollFateDice": typeof tools_rollFateDice;
  triggers: typeof triggers;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
