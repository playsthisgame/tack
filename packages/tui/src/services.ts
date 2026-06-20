import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import {
  BpeTokenizer,
  defaultConfig,
  HeuristicScorer,
  SqliteDecisionLog,
  type DispatchResult,
  type PromptContext,
  type RoutingDecision,
  type Tier,
} from "@tack/core";
import {
  AiSdkDispatcher,
  envVarForProvider,
  FileSecretsStore,
  parseModelString,
  requiredProviders,
  resolveKey,
  type SecretsStore,
} from "@tack/dispatch";

/**
 * The capabilities the TUI needs, expressed as plain functions rather than
 * concrete classes. Components depend on this seam so tests can inject fakes
 * (stub scorer/dispatcher) without touching the network or disk.
 */
export interface TackServices {
  score(context: PromptContext): Promise<RoutingDecision>;
  /** Concrete model string for a tier (e.g. `anthropic/claude-sonnet-4.6`). */
  modelFor(tier: Tier): string;
  /** Best-effort decision logging — never throws into the UI. */
  log(context: PromptContext, decision: RoutingDecision, model: string): void;
  dispatch(model: string, context: PromptContext): Promise<DispatchResult>;
  /** The resolved API key for a provider, or undefined if none is available. */
  resolveKey(provider: string): string | undefined;
  /** Make a key usable for subsequent dispatch; persist it when `save` is true. */
  saveKey(provider: string, key: string, save: boolean): void;
}

const DEFAULT_DB_PATH = "./.tack/tack.db";

function dbPath(): string {
  return process.env.TACK_DB_PATH ?? DEFAULT_DB_PATH;
}

/**
 * Wire the real services. Key resolution flows through a mutable `env` copy that
 * `saveKey` updates, which is the same object the dispatcher reads from — so an
 * in-session key entry is immediately usable, and the dispatcher stays unchanged.
 */
export function createServices(): TackServices {
  const env: Record<string, string | undefined> = { ...process.env };
  const store: SecretsStore = new FileSecretsStore();

  // Preload persisted keys into env and process.env so @ai-sdk providers find them.
  for (const provider of requiredProviders(defaultConfig.tierModels)) {
    const envVar = envVarForProvider(provider);
    if (envVar && !env[envVar]) {
      const key = store.get(provider);
      if (key) {
        env[envVar] = key;
        process.env[envVar] = key;
      }
    }
  }

  const dispatcher = new AiSdkDispatcher({ env });

  let log: SqliteDecisionLog | undefined;
  try {
    mkdirSync(dirname(dbPath()), { recursive: true });
    log = new SqliteDecisionLog(dbPath());
  } catch {
    log = undefined; // logging is best-effort; a bad path must not break the TUI
  }

  return {
    score: (context) => new HeuristicScorer(defaultConfig, new BpeTokenizer()).score(context),
    modelFor: (tier) => defaultConfig.tierModels[tier],
    log: (context, decision, model) => {
      try {
        log?.record(context, decision, model);
      } catch {
        // swallow — never let logging disrupt the session
      }
    },
    dispatch: (model, context) => dispatcher.dispatch(model, context),
    resolveKey: (provider) => resolveKey(provider, { env, store }),
    saveKey: (provider, key, save) => {
      const envVar = envVarForProvider(provider);
      if (envVar) {
        env[envVar] = key;
        process.env[envVar] = key; // @ai-sdk providers read process.env at request time
      }
      if (save) store.set(provider, key);
    },
  };
}

/** The provider half of a `provider/model` string. */
export function providerOf(model: string): string {
  return parseModelString(model).provider;
}
