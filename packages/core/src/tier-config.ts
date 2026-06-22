import { dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { defaultConfig, type ScoringConfig } from "./config";
import { TIER_ORDER } from "./tier";
import type { Tier } from "./types";

/**
 * A user override for one tier: the model plus the context window and input cost
 * that must stay coherent with it (routing uses the window for feasibility, the
 * advisory uses the cost). All three travel together so context-aware routing and
 * the cost advisory stay consistent with the chosen model.
 */
export interface TierModelOverride {
  model: string;
  window: number;
  costPer1M: number;
}

/** Partial per-tier overrides; tiers absent here keep their built-in defaults. */
export type TierModelConfig = Partial<Record<Tier, TierModelOverride>>;

/**
 * Read/write access to the persisted tier-model overrides. Kept distinct from the
 * secrets store (API keys) and from source — this is shareable routing config.
 */
export interface ConfigStore {
  load(): TierModelConfig;
  save(tier: Tier, override: TierModelOverride): void;
}

/** Default config path: `./.tack/config.json`, overridable via `TACK_CONFIG_PATH`. */
export function defaultConfigPath(): string {
  return process.env.TACK_CONFIG_PATH ?? "./.tack/config.json";
}

/**
 * Built-in model catalog: known model ids → their context window and input cost.
 * When a user assigns a known model to a tier, window/cost auto-fill from here so
 * routing stays correct without the user supplying them. Unknown models require an
 * explicit window from the caller.
 */
export const MODEL_CATALOG: Record<string, { window: number; costPer1M: number }> = {
  "anthropic/claude-haiku-4-5": { window: 200_000, costPer1M: 1 },
  "anthropic/claude-sonnet-4-6": { window: 1_000_000, costPer1M: 3 },
  "anthropic/claude-opus-4-8": { window: 1_000_000, costPer1M: 5 },
  // Placeholders — reasonable starting points for the non-Anthropic providers, tuned
  // by the user via the model editor. Windows/costs are approximate, not authoritative.
  "openai/gpt-4o-mini": { window: 128_000, costPer1M: 1 },
  "openai/gpt-4o": { window: 128_000, costPer1M: 3 },
  "openai/o1": { window: 200_000, costPer1M: 15 },
  "google/gemini-1.5-flash": { window: 1_000_000, costPer1M: 1 },
  "google/gemini-1.5-pro": { window: 2_000_000, costPer1M: 5 },
};

/** Look up a known model's window/cost, or `undefined` if it is not in the catalog. */
export function lookupModel(model: string): { window: number; costPer1M: number } | undefined {
  return MODEL_CATALOG[model];
}

/** Build a tier override for a catalogued model. */
function fromCatalog(model: string): TierModelOverride {
  const c = MODEL_CATALOG[model];
  if (!c) throw new Error(`tier-config: ${model} is not in MODEL_CATALOG`);
  return { model, window: c.window, costPer1M: c.costPer1M };
}

/**
 * Per-provider default tier→model mapping, used by first-run "connect" to point all
 * tiers at a chosen provider. Keyed by the dispatch provider registry's names. The
 * Anthropic set mirrors `defaultConfig`; the others are catalogued placeholders.
 */
export const PROVIDER_TIER_DEFAULTS: Record<string, Record<Tier, TierModelOverride>> = {
  anthropic: {
    cheap: fromCatalog("anthropic/claude-haiku-4-5"),
    mid: fromCatalog("anthropic/claude-sonnet-4-6"),
    frontier: fromCatalog("anthropic/claude-opus-4-8"),
  },
  openai: {
    cheap: fromCatalog("openai/gpt-4o-mini"),
    mid: fromCatalog("openai/gpt-4o"),
    frontier: fromCatalog("openai/o1"),
  },
  google: {
    cheap: fromCatalog("google/gemini-1.5-flash"),
    mid: fromCatalog("google/gemini-1.5-pro"),
    frontier: fromCatalog("google/gemini-1.5-pro"),
  },
};

/** Default tier→model overrides for a provider, or `undefined` if it has no defaults. */
export function providerTierDefaults(provider: string): Record<Tier, TierModelOverride> | undefined {
  return PROVIDER_TIER_DEFAULTS[provider];
}

const TIERS: ReadonlySet<string> = new Set<Tier>(TIER_ORDER);

function isValidOverride(value: unknown): value is TierModelOverride {
  const o = value as Partial<TierModelOverride>;
  return (
    typeof o === "object" &&
    o !== null &&
    typeof o.model === "string" &&
    typeof o.window === "number" &&
    Number.isFinite(o.window) &&
    typeof o.costPer1M === "number" &&
    Number.isFinite(o.costPer1M)
  );
}

/**
 * File-backed config store. Persists `{ tiers: { <tier>: override } }` as JSON at
 * `defaultConfigPath()`. A missing file loads as empty; a corrupt file loads as
 * empty with a warning (mirrors the empty-`seeds.json` tolerance) rather than
 * crashing routing. Malformed individual entries are dropped.
 */
export class FileConfigStore implements ConfigStore {
  constructor(private readonly path: string = defaultConfigPath()) {}

  load(): TierModelConfig {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch {
      return {}; // missing file — defaults apply
    }
    let parsed: { tiers?: unknown };
    try {
      parsed = JSON.parse(raw) as { tiers?: unknown };
    } catch {
      console.error(`warning: ignoring unparsable config file ${this.path}`);
      return {};
    }
    const tiers = (parsed.tiers ?? {}) as Record<string, unknown>;
    const out: TierModelConfig = {};
    for (const tier of TIER_ORDER) {
      const entry = tiers[tier];
      if (entry !== undefined && isValidOverride(entry)) {
        out[tier] = entry;
      }
    }
    return out;
  }

  save(tier: Tier, override: TierModelOverride): void {
    if (!TIERS.has(tier)) throw new Error(`unknown tier "${tier}"`);
    const current = this.load();
    current[tier] = override;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify({ tiers: current }, null, 2));
  }
}

/**
 * Merge stored tier-model overrides over a base config into a full `ScoringConfig`.
 * Each override updates `tierModels`, `tierWindows`, and `tierCostPer1M` together;
 * tiers without an override keep the base values. With no store (or no overrides),
 * the base config is returned unchanged.
 */
export function loadConfig(store?: ConfigStore, base: ScoringConfig = defaultConfig): ScoringConfig {
  const overrides = store?.load() ?? {};
  const tierModels = { ...base.tierModels };
  const tierWindows = { ...base.tierWindows };
  const tierCostPer1M = { ...base.tierCostPer1M };

  for (const tier of TIER_ORDER) {
    const o = overrides[tier];
    if (o) {
      tierModels[tier] = o.model;
      tierWindows[tier] = o.window;
      tierCostPer1M[tier] = o.costPer1M;
    }
  }

  return { ...base, tierModels, tierWindows, tierCostPer1M };
}
