import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import {
  buildScorer,
  CopilotAuth,
  defaultCopilotConfig,
  FileConfigStore,
  loadConfig,
  lookupModel,
  providerTierDefaults,
  SqliteCopilotAuthStore,
  SqliteDecisionLog,
  SqliteLabeledExampleStore,
  TransformersEmbedder,
  type AgentEvent,
  type DeviceCodeResult,
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
  registryWithCopilot,
  requiredProviders,
  resolveKey,
  validateModelString,
  type ProviderRegistry,
  type SecretsStore,
} from "@tack/dispatch";

const TIERS: Tier[] = ["cheap", "mid", "frontier"];

/** A pickable provider for the connect flow. */
export interface ProviderChoice {
  name: string;
  label: string;
  connected: boolean;
  /** True for providers that use browser-based sign-in (device flow) instead of an API key. */
  browserSignIn?: boolean;
}

/**
 * Result of connecting a provider on first run / via `/connect`. `kind`
 * discriminates the auth UI the caller must show next: `"key"` providers prompt
 * for an API key (when `needsKey`); `"device"` providers (Copilot) run the
 * browser device flow via `connectCopilot` instead.
 */
export type ConnectResult =
  | { ok: true; kind: "key"; needsKey: boolean; provider: string; label: string }
  | { ok: true; kind: "device"; provider: string; label: string }
  | { ok: false; error: string };

/** Progress callbacks for the Copilot device flow. */
export interface CopilotConnectCallbacks {
  onUserCode?: (device: DeviceCodeResult) => void;
}

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
  /**
   * Run the Copilot browser device flow (reusing an OpenCode token when valid),
   * persisting auth to the dedicated Copilot store. `onUserCode` fires with the
   * code the user must enter at GitHub. Resolves once authenticated.
   */
  connectCopilot(callbacks?: CopilotConnectCallbacks): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Previously submitted prompts, oldest → newest, for prompt-history navigation. */
  history(): string[];
  log(context: PromptContext, decision: RoutingDecision, model: string): void;
  dispatch(context: PromptContext): AsyncIterable<AgentEvent>;
  resolveKey(provider: string): string | undefined;
  saveKey(provider: string, key: string, save: boolean): void;
}

const DEFAULT_DB_PATH = "./.tack/tack.db";
const DEFAULT_COPILOT_DB_PATH = "./.tack/copilot-auth.db";

function dbPath(): string {
  return process.env.TACK_DB_PATH ?? DEFAULT_DB_PATH;
}

/** Copilot auth lives in its own DB file — secrets never share the routing log. */
function copilotDbPath(): string {
  return process.env.TACK_COPILOT_DB_PATH ?? DEFAULT_COPILOT_DB_PATH;
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

  // Copilot auth: a dedicated store (separate DB) plus the auth orchestrator that
  // drives the device flow and exchanges/caches the Copilot bearer token.
  mkdirSync(dirname(copilotDbPath()), { recursive: true });
  const copilotStore = new SqliteCopilotAuthStore(copilotDbPath());
  const copilotAuth = new CopilotAuth({ store: copilotStore, config: defaultCopilotConfig });

  /** Whether a tier's provider is Copilot (which is connected via auth state, not a key). */
  const isCopilot = (provider: string): boolean => provider === "copilot";

  // A single embedder instance reused across rebuilds so changing a tier model does
  // not reload the embedding model (which is independent of the routed model).
  const embedder = new TransformersEmbedder(config.knn.model, config.knn.dimension);

  // Build the scorer (the k-NN default loads its model + labeled set on first use)
  // and share one instance between the preview `score()` and the dispatcher. Both
  // the wrapper and `dispatch` read the current `scorerPromise`/`dispatcher`, so a
  // rebuild after a config change is picked up on the next prompt.
  let scorerPromise: Promise<Scorer> = buildScorer(config, { store: labeledStore, embedder });
  const scorer: Scorer = { score: async (context) => (await scorerPromise).score(context) };
  // The registry carries Copilot so a Copilot-backed tier resolves without an API
  // key (its bearer is injected per request by the provider's fetch wrapper).
  const registry: ProviderRegistry = registryWithCopilot(copilotAuth, defaultCopilotConfig);
  let dispatcher = new AiSdkDispatcher({ env, scorer, config, registry });

  const rebuild = (): void => {
    scorerPromise = buildScorer(config, { store: labeledStore, embedder });
    dispatcher = new AiSdkDispatcher({ env, scorer, config, registry });
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
      requiredProviders(config.tierModels).some((p) =>
        isCopilot(p) ? copilotAuth.isConnected() : resolveKey(p, { env, store }) !== undefined,
      ),
    providers: () => [
      ...knownProviders().map((name) => ({
        name,
        label: PROVIDER_LABELS[name as keyof typeof PROVIDER_LABELS] ?? name,
        connected: resolveKey(name, { env, store }) !== undefined,
      })),
      {
        name: "copilot",
        label: PROVIDER_LABELS.copilot,
        connected: copilotAuth.isConnected(),
        browserSignIn: true,
      },
    ],
    connectProvider: (name): ConnectResult => {
      const defaults = providerTierDefaults(name);
      if (!defaults) return { ok: false, error: `unknown provider "${name}"` };
      try {
        for (const tier of TIERS) configStore.save(tier, defaults[tier]);
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
      config = loadConfig(configStore);
      const label = PROVIDER_LABELS[name as keyof typeof PROVIDER_LABELS] ?? name;
      rebuild();
      // Copilot does not take an API key — it authenticates via the device flow.
      if (isCopilot(name)) {
        return { ok: true, kind: "device", provider: name, label };
      }
      preloadKey(name);
      return {
        ok: true,
        kind: "key",
        provider: name,
        label,
        needsKey: resolveKey(name, { env, store }) === undefined,
      };
    },
    connectCopilot: async (callbacks) => {
      try {
        await copilotAuth.connect({ onUserCode: callbacks?.onUserCode });
        rebuild();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
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
