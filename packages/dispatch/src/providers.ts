import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

/**
 * One supported provider dialect. `model` builds an AI SDK language model from a
 * bare model id; `envVar` is the API key the provider reads from the environment.
 *
 * Only the provider *dialects* are known here — model ids stay config-driven
 * (Tack ships no hardcoded model list), so adding a model never touches code.
 */
export interface ProviderEntry {
  model: (modelId: string) => LanguageModel;
  envVar: string;
}

export type ProviderName = "anthropic" | "openai" | "google";

/**
 * The registry mapping provider names to their AI SDK factories. This is the one
 * swappable table of provider knowledge; a new provider is a new entry here.
 */
export const defaultRegistry: Record<ProviderName, ProviderEntry> = {
  anthropic: { model: (id) => anthropic(id), envVar: "ANTHROPIC_API_KEY" },
  openai: { model: (id) => openai(id), envVar: "OPENAI_API_KEY" },
  google: { model: (id) => google(id), envVar: "GOOGLE_GENERATIVE_AI_API_KEY" },
};

export type ProviderRegistry = Record<string, ProviderEntry>;

/** Thrown when a model string is malformed or names an unsupported provider. */
export class UnknownProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownProviderError";
  }
}

/** Thrown when the required provider API key is absent from the environment. */
export class MissingApiKeyError extends Error {
  constructor(public readonly envVar: string) {
    super(`${envVar} is not set — required to dispatch this model`);
    this.name = "MissingApiKeyError";
  }
}

/**
 * Split a `provider/model` string into its parts. Throws `UnknownProviderError`
 * if there is no `/` or either side is empty.
 */
export function parseModelString(model: string): { provider: string; modelId: string } {
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) {
    throw new UnknownProviderError(
      `invalid model "${model}": expected "provider/model" form`,
    );
  }
  return { provider: model.slice(0, slash), modelId: model.slice(slash + 1) };
}

/**
 * Resolve a `provider/model` string against the registry and verify its API key
 * is present, WITHOUT making any network call. Returns the AI SDK language model
 * ready to dispatch.
 */
export function resolveModel(
  model: string,
  registry: ProviderRegistry = defaultRegistry,
  env: Record<string, string | undefined> = process.env,
): LanguageModel {
  const { provider, modelId } = parseModelString(model);
  const entry = registry[provider];
  if (!entry) {
    throw new UnknownProviderError(
      `unsupported provider "${provider}" in model "${model}"`,
    );
  }
  if (!env[entry.envVar]) {
    throw new MissingApiKeyError(entry.envVar);
  }
  return entry.model(modelId);
}
