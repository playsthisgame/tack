import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import {
  BpeTokenizer,
  defaultConfig,
  HeuristicScorer,
  SqliteDecisionLog,
  type AgentEvent,
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

export interface TackServices {
  score(context: PromptContext): Promise<RoutingDecision>;
  modelFor(tier: Tier): string;
  log(context: PromptContext, decision: RoutingDecision, model: string): void;
  dispatch(context: PromptContext): AsyncIterable<AgentEvent>;
  resolveKey(provider: string): string | undefined;
  saveKey(provider: string, key: string, save: boolean): void;
}

const DEFAULT_DB_PATH = "./.tack/tack.db";

function dbPath(): string {
  return process.env.TACK_DB_PATH ?? DEFAULT_DB_PATH;
}

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

  const scorer = new HeuristicScorer(defaultConfig, new BpeTokenizer());
  const dispatcher = new AiSdkDispatcher({ env, scorer, config: defaultConfig });

  let log: SqliteDecisionLog | undefined;
  try {
    mkdirSync(dirname(dbPath()), { recursive: true });
    log = new SqliteDecisionLog(dbPath());
  } catch {
    log = undefined;
  }

  return {
    score: (context) => scorer.score(context),
    modelFor: (tier) => defaultConfig.tierModels[tier],
    log: (context, decision, model) => {
      try {
        log?.record(context, decision, model);
      } catch {
        // swallow — never let logging disrupt the session
      }
    },
    dispatch: (context) => dispatcher.dispatch(context),
    resolveKey: (provider) => resolveKey(provider, { env, store }),
    saveKey: (provider, key, save) => {
      const envVar = envVarForProvider(provider);
      if (envVar) {
        env[envVar] = key;
        process.env[envVar] = key;
      }
      if (save) store.set(provider, key);
    },
  };
}

export function providerOf(model: string): string {
  return parseModelString(model).provider;
}
