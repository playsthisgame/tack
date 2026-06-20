import { streamText as defaultStreamText, type CoreMessage } from "ai";
import type { Dispatcher, DispatchResult, PromptContext } from "@tack/core";
import {
  defaultRegistry,
  resolveModel,
  type ProviderRegistry,
} from "./providers";

/** Minimal shape of `streamText` we depend on — lets tests inject a fake stream. */
type StreamText = typeof defaultStreamText;

export interface AiSdkDispatcherOptions {
  /** Provider registry; defaults to the built-in anthropic/openai/google set. */
  registry?: ProviderRegistry;
  /** Environment to read API keys from; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** AI SDK `streamText`; injectable so tests can stub the network. */
  streamText?: StreamText;
}

/**
 * `Dispatcher` backed by the Vercel AI SDK. All provider- and SDK-specific code
 * is isolated here (and in `providers.ts`), keeping `core` provider-free.
 *
 * Resolution and key checks happen up front via `resolveModel`, so a malformed
 * model string, an unsupported provider, or a missing API key fails before any
 * network call. Provider/network errors surface while iterating `textStream`;
 * callers iterate inside their own try/catch.
 */
export class AiSdkDispatcher implements Dispatcher {
  private readonly registry: ProviderRegistry;
  private readonly env: Record<string, string | undefined>;
  private readonly streamText: StreamText;

  constructor(options: AiSdkDispatcherOptions = {}) {
    this.registry = options.registry ?? defaultRegistry;
    this.env = options.env ?? process.env;
    this.streamText = options.streamText ?? defaultStreamText;
  }

  async dispatch(model: string, context: PromptContext): Promise<DispatchResult> {
    // Throws UnknownProviderError / MissingApiKeyError before any network call.
    const languageModel = resolveModel(model, this.registry, this.env);

    const result = this.streamText({
      model: languageModel,
      messages: toMessages(context),
    });

    return { textStream: result.textStream };
  }
}

/** Map the scored `PromptContext` into the AI SDK message array that gets sent. */
export function toMessages(context: PromptContext): CoreMessage[] {
  const messages: CoreMessage[] = [];
  if (context.system) {
    messages.push({ role: "system", content: context.system });
  }
  for (const m of context.history) {
    messages.push({ role: m.role, content: m.content });
  }
  messages.push({ role: "user", content: context.prompt });
  return messages;
}
