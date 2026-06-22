import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defaultCopilotConfig, type CopilotAuth, type CopilotConfig } from "@tack/core";
import type { LanguageModel } from "ai";
import { defaultRegistry, type ProviderEntry, type ProviderRegistry } from "./providers";

/** The minimal slice of `CopilotAuth` the provider needs: a fresh bearer token. */
export interface TokenSource {
  ensureFreshToken(): Promise<string>;
}

export interface CopilotProviderOptions {
  auth: TokenSource;
  config?: CopilotConfig;
  /** Override the underlying fetch (tests assert on the headers it receives). */
  fetch?: typeof fetch;
}

/**
 * Wrap a base `fetch` so every request carries a fresh Copilot bearer token plus
 * the required editor headers. Exposed so the header behavior is unit-testable
 * without constructing a full language-model request.
 */
export function authedCopilotFetch(
  auth: TokenSource,
  config: CopilotConfig,
  baseFetch: typeof fetch = fetch,
) {
  return async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const token = await auth.ensureFreshToken();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    for (const [key, value] of Object.entries(config.editorHeaders)) {
      headers.set(key, value);
    }
    return baseFetch(input, { ...init, headers });
  };
}

/**
 * Build a Copilot provider whose models are standard AI-SDK `LanguageModel`s, so
 * the dispatcher invokes them through its existing call path with no
 * Copilot-specific branching.
 *
 * Auth is handled inside a `fetch` wrapper rather than via static headers: each
 * outgoing request calls `ensureFreshToken()` (lazy refresh at request time) and
 * stamps the `Authorization` bearer plus the required editor headers. This keeps
 * model construction synchronous while every request still carries a valid token.
 */
export function createCopilotProvider(
  options: CopilotProviderOptions,
): { model: (modelId: string) => LanguageModel } {
  const config = options.config ?? defaultCopilotConfig;
  const authedFetch = authedCopilotFetch(options.auth, config, options.fetch);

  const provider = createOpenAICompatible({
    name: "copilot",
    baseURL: config.completionsBaseUrl,
    // The AI SDK only ever invokes fetch as a function; `preconnect` is unused, so
    // the cast past `typeof fetch`'s extra member is safe.
    fetch: authedFetch as unknown as typeof fetch,
  });

  return { model: (modelId) => provider.languageModel(modelId) };
}

/**
 * Adapt a `CopilotAuth` into a dispatch `ProviderEntry`. The entry has no
 * `envVar` — Copilot manages its own auth via the device flow, so `resolveModel`
 * must not require an API key for it.
 */
export function copilotProviderEntry(
  auth: CopilotAuth,
  config?: CopilotConfig,
): ProviderEntry {
  const { model } = createCopilotProvider({ auth, config });
  return { model };
}

/**
 * A provider registry that includes Copilot, built from a live `CopilotAuth`.
 * Use this when constructing the dispatcher so a Copilot-backed tier resolves
 * without an API key. Tiers on other providers are unaffected.
 */
export function registryWithCopilot(
  auth: CopilotAuth,
  config?: CopilotConfig,
  base: ProviderRegistry = defaultRegistry,
): ProviderRegistry {
  return { ...base, copilot: copilotProviderEntry(auth, config) };
}
