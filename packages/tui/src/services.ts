import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import {
  buildScorer,
  FileConfigStore,
  loadConfig,
  lookupModel,
  providerTierDefaults,
  SqliteDecisionLog,
  SqliteLabeledExampleStore,
  TransformersEmbedder,
  type AgentEvent,
  type LabeledExampleStore,
  type PromptContext,
  type RoutingDecision,
  type Scorer,
  type ScoringConfig,
  type Tier,
} from "@tack/core";
import {
  AiSdkDispatcher,
  envVarForProvider,
  FileSecretsStore,
  knownProviders,
  parseModelString,
  PROVIDER_LABELS,
  requiredProviders,
  resolveKey,
  validateModelString,
  type SecretsStore,
} from "@tack/dispatch";

const TIERS: Tier[] = ["cheap", "mid", "frontier"];

/** A pickable provider for the connect flow. */
export interface ProviderChoice {
  name: string;
  label: string;
  connected: boolean;
}

/** Result of connecting a provider on first run / via `/connect`. */
export type ConnectResult =
  | { ok: true; needsKey: boolean; provider: string; label: string }
  | { ok: false; error: string };

/** Result of attempting to set a tier's model from the editor. */
export type SetTierModelResult =
  | { ok: true }
  | { ok: false; error: string; needsWindow?: boolean };

export interface TackServices {
  score(context: PromptContext): Promise<RoutingDecision>;
  modelFor(tier: Tier): string;
  /** Current model assigned to each tier (reflects saved overrides). */
  tierModels(): Record<Tier, string>;
  /**
   * Validate and persist a tier's model, applying it to subsequent prompts. A model
   * not in the known catalog needs an explicit `window`; without one the result is
   * `{ ok: false, needsWindow: true }` so the editor can prompt for it.
   */
  setTierModel(tier: Tier, model: string, window?: number): SetTierModelResult;
  /** True once at least one provider used by the current tier models has a resolvable key. */
  isConnected(): boolean;
  /** The pickable providers (with labels and whether each already has a key). */
  providers(): ProviderChoice[];
  /**
   * Point all tiers at a provider's default models and apply it. Reports whether a key
   * is still needed so the caller can prompt for it.
   */
  connectProvider(name: string): ConnectResult;
  /** Previously submitted prompts, oldest → newest, for prompt-history navigation. */
  history(): string[];
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
  const configStore = new FileConfigStore();

  // Built-in defaults merged with the user's persisted tier-model overrides. Held
  // mutably so an in-session model change can be applied without a restart.
  let config: ScoringConfig = loadConfig(configStore);

  /** Pull a provider's persisted key into env so @ai-sdk providers find it. */
  const preloadKey = (provider: string): void => {
    const envVar = envVarForProvider(provider);
    if (envVar && !env[envVar]) {
      const key = store.get(provider);
      if (key) {
        env[envVar] = key;
        process.env[envVar] = key;
      }
    }
  };

  for (const provider of requiredProviders(config.tierModels)) preloadKey(provider);

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

  // A single embedder instance reused across rebuilds so changing a tier model does
  // not reload the embedding model (which is independent of the routed model).
  const embedder = new TransformersEmbedder(config.knn.model, config.knn.dimension);

  // Build the scorer (the k-NN default loads its model + labeled set on first use)
  // and share one instance between the preview `score()` and the dispatcher. Both
  // the wrapper and `dispatch` read the current `scorerPromise`/`dispatcher`, so a
  // rebuild after a config change is picked up on the next prompt.
  let scorerPromise: Promise<Scorer> = buildScorer(config, { store: labeledStore, embedder });
  const scorer: Scorer = { score: async (context) => (await scorerPromise).score(context) };
  let dispatcher = new AiSdkDispatcher({ env, scorer, config });

  const rebuild = (): void => {
    scorerPromise = buildScorer(config, { store: labeledStore, embedder });
    dispatcher = new AiSdkDispatcher({ env, scorer, config });
  };

  return {
    score: (context) => scorer.score(context),
    modelFor: (tier) => config.tierModels[tier],
    tierModels: () => ({ ...config.tierModels }),
    setTierModel: (tier, model, window) => {
      const valid = validateModelString(model);
      if (!valid.ok) return { ok: false, error: valid.error };

      const known = lookupModel(model);
      const win = window ?? known?.window;
      if (win === undefined) {
        return { ok: false, error: `unknown model — enter a context window for ${model}`, needsWindow: true };
      }
      const costPer1M = known?.costPer1M ?? config.tierCostPer1M[tier];

      try {
        configStore.save(tier, { model, window: win, costPer1M });
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }

      config = loadConfig(configStore);
      preloadKey(providerOf(model));
      rebuild();
      return { ok: true };
    },
    isConnected: () =>
      requiredProviders(config.tierModels).some(
        (p) => resolveKey(p, { env, store }) !== undefined,
      ),
    providers: () =>
      knownProviders().map((name) => ({
        name,
        label: PROVIDER_LABELS[name as keyof typeof PROVIDER_LABELS] ?? name,
        connected: resolveKey(name, { env, store }) !== undefined,
      })),
    connectProvider: (name): ConnectResult => {
      const defaults = providerTierDefaults(name);
      if (!defaults) return { ok: false, error: `unknown provider "${name}"` };
      try {
        for (const tier of TIERS) configStore.save(tier, defaults[tier]);
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
      config = loadConfig(configStore);
      preloadKey(name);
      rebuild();
      return {
        ok: true,
        provider: name,
        label: PROVIDER_LABELS[name as keyof typeof PROVIDER_LABELS] ?? name,
        needsKey: resolveKey(name, { env, store }) === undefined,
      };
    },
    history: () => {
      try {
        return log?.recentPrompts(200) ?? [];
      } catch {
        return [];
      }
    },
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
