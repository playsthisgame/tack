import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

/**
 * One supported provider dialect. `model` builds an AI SDK language model from a
 * bare model id; `envVar` is the API key the provider reads from the environment.
 *
 * `envVar` is OPTIONAL: providers that manage their own auth (e.g. Copilot, which
 * authenticates via GitHub device flow and injects a bearer per request) omit it,
 * and `resolveModel` then skips the API-key check for them.
 *
 * Only the provider *dialects* are known here — model ids stay config-driven
 * (Tack ships no hardcoded model list), so adding a model never touches code.
 */
export interface ProviderEntry {
  model: (modelId: string) => LanguageModel;
  envVar?: string;
}

export type ProviderName = "anthropic" | "openai" | "google" | "copilot";

/**
 * The registry mapping provider names to their AI SDK factories. This is the one
 * swappable table of provider knowledge; a new provider is a new entry here.
 */
export const defaultRegistry: Record<"anthropic" | "openai" | "google", ProviderEntry> = {
  anthropic: { model: (id) => anthropic(id), envVar: "ANTHROPIC_API_KEY" },
  openai: { model: (id) => openai(id), envVar: "OPENAI_API_KEY" },
  google: { model: (id) => google(id), envVar: "GOOGLE_GENERATIVE_AI_API_KEY" },
};

export type ProviderRegistry = Record<string, ProviderEntry>;

/** Human-readable labels for the provider picker. */
export const PROVIDER_LABELS: Record<ProviderName, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI (ChatGPT)",
  google: "Google (Gemini)",
  copilot: "GitHub Copilot (browser sign-in)",
};

/** The provider names known to a registry (defaults to the built-in one). */
export function knownProviders(registry: ProviderRegistry = defaultRegistry): string[] {
  return Object.keys(registry);
}

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
 * Validate a `provider/model` string for configuration: it must parse and name a
 * provider in the registry. Returns `{ ok: true }` or a clear error message naming
 * the offending value. This is the check the model-config editor runs before
 * persisting, so `@tack/core` need not know the provider set.
 */
export function validateModelString(
  model: string,
  registry: ProviderRegistry = defaultRegistry,
): { ok: true } | { ok: false; error: string } {
  let provider: string;
  try {
    ({ provider } = parseModelString(model));
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!registry[provider]) {
    return {
      ok: false,
      error: `unknown provider "${provider}" (known: ${Object.keys(registry).join(", ")})`,
    };
  }
  return { ok: true };
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
  // Providers without an `envVar` manage their own auth (e.g. Copilot's device
  // flow) — there is no API key to require.
  if (entry.envVar && !env[entry.envVar]) {
    throw new MissingApiKeyError(entry.envVar);
  }
  return entry.model(modelId);
}
