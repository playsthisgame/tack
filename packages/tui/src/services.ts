import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import {
  buildScorer,
  defaultConfig,
  SqliteDecisionLog,
  SqliteLabeledExampleStore,
  type AgentEvent,
  type LabeledExampleStore,
  type PromptContext,
  type RoutingDecision,
  type Scorer,
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

  let log: SqliteDecisionLog | undefined;
  let labeledStore: LabeledExampleStore | undefined;
  try {
    mkdirSync(dirname(dbPath()), { recursive: true });
    log = new SqliteDecisionLog(dbPath());
    // The k-NN scorer reads the user's own labeled examples from the same DB.
    labeledStore = new SqliteLabeledExampleStore(dbPath());
  } catch {
    log = undefined;
    labeledStore = undefined;
  }

  // Build the configured scorer once (the k-NN default loads its model + labeled set
  // on first use) and share that single instance between the preview `score()` and
  // the dispatcher, so the model is never loaded twice.
  let scorerPromise: Promise<Scorer> | null = null;
  const getScorer = (): Promise<Scorer> =>
    (scorerPromise ??= buildScorer(defaultConfig, { store: labeledStore }));
  const scorer: Scorer = { score: async (context) => (await getScorer()).score(context) };
  const dispatcher = new AiSdkDispatcher({ env, scorer, config: defaultConfig });

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
