import type { Tier } from "./types";

/** Which scorer produces routing decisions. Selectable; never hardcoded at a call site. */
export type ScorerKind = "heuristic" | "knn";

/** What to do when the k-NN scorer is not confident in its vote. */
export type UncertaintyPolicy = "escalate" | "fallback";

/**
 * All k-NN scorer parameters. Every threshold lives here, never as a magic number in
 * the scoring logic — tuning the scorer means editing config (or the labeled set),
 * not code.
 */
export interface KnnConfig {
  /** The embedding model and its dimension (the loader's cross-model guard). */
  model: string;
  dimension: number;
  /** Number of nearest neighbors to consult. */
  k: number;
  /**
   * Cosine-distance ceiling for "near". When every one of the k neighbors is farther
   * than this, the decision is flagged uncertain.
   */
  distanceThreshold: number;
  /**
   * Minimum weighted-vote margin (winner − runner-up, normalized) for a confident
   * decision. Below this the vote is "close" and the decision is flagged uncertain.
   */
  marginThreshold: number;
  /** What to do on uncertainty: escalate one tier, or fall back to the heuristic scorer. */
  uncertaintyPolicy: UncertaintyPolicy;
}

/**
 * All tunable scoring parameters live here, never buried as magic numbers in
 * the scoring logic. This is the file a user edits to change routing behavior,
 * and the structure a future config-file loader will populate.
 */
export interface ScoringConfig {
  /** Token-count bands. Each band contributes its weight if the count exceeds `over`. */
  tokenBands: { over: number; weight: number }[];

  /** Content-pattern signals (stack traces, diffs, etc.). */
  content: {
    stackTrace: number;
    largeDiff: number;
    multiFile: number;
    codeBlock: number;
  };

  /** Keywords that raise (or lower) complexity. Matched case-insensitively. */
  keywords: {
    raise: { word: string; weight: number }[];
    lower: { word: string; weight: number }[];
  };

  /** Conversation-depth signal: weight added once history exceeds `turnsOver`. */
  conversationDepth: { turnsOver: number; weight: number };

  /** Score thresholds. score < mid => cheap; mid <= score < frontier => mid; else frontier. */
  thresholds: { mid: number; frontier: number };

  /** User-assigned model per tier. Tack ships no hardcoded model list. */
  tierModels: Record<Tier, string>;

  /**
   * Context-window size (in tokens) of each tier's model. Used as a hard
   * routing constraint: the router never selects a tier whose window cannot
   * hold the measured context plus `responseHeadroom`. Tunable per deployment.
   */
  tierWindows: Record<Tier, number>;

  /**
   * Relative input cost per tier, in dollars per 1M tokens. Used only to
   * estimate the extra spend caused by context-driven escalations; it does not
   * affect routing. Tunable.
   */
  tierCostPer1M: Record<Tier, number>;

  /**
   * Tokens held in reserve out of each model's window for the response. A tier
   * is feasible only when `tierWindows[tier] - responseHeadroom >= tokenCount`.
   * Tunable.
   */
  responseHeadroom: number;

  /**
   * Number of cost-driven escalations in a session before the passive
   * compaction advisory is surfaced. Tunable.
   */
  advisoryThreshold: number;

  /**
   * Which scorer to use. The heuristic scorer (surface signals) and the k-NN scorer
   * (semantic similarity) both satisfy `Scorer`; this selects between them.
   */
  scorer: ScorerKind;

  /** k-NN scorer parameters. Used only when `scorer` is `"knn"`. */
  knn: KnnConfig;
}

/**
 * Sensible defaults for the POC. These are starting points to be tuned against
 * real logged data, not claims of correctness.
 */
export const defaultConfig: ScoringConfig = {
  tokenBands: [
    { over: 500, weight: 1 },
    { over: 2000, weight: 2 },
    { over: 6000, weight: 2 },
  ],
  content: {
    stackTrace: 2,
    largeDiff: 2,
    multiFile: 1,
    codeBlock: 1,
  },
  keywords: {
    raise: [
      { word: "refactor", weight: 2 },
      { word: "architect", weight: 2 },
      { word: "design", weight: 1 },
      { word: "debug", weight: 1 },
      { word: "why", weight: 1 },
      { word: "optimize", weight: 1 },
    ],
    lower: [
      { word: "rename", weight: 2 },
      { word: "typo", weight: 2 },
      { word: "comment", weight: 1 },
      { word: "format", weight: 1 },
    ],
  },
  conversationDepth: { turnsOver: 8, weight: 1 },
  thresholds: { mid: 2, frontier: 5 },
  // Placeholders — the user overrides these. Model strings follow the
  // AI SDK's "provider/model" form.
  tierModels: {
    cheap: "anthropic/claude-haiku-4-5",
    mid: "anthropic/claude-sonnet-4-6",
    frontier: "anthropic/claude-opus-4-8",
  },
  // Context windows of the default models above. Override these alongside
  // `tierModels` whenever the assigned models change.
  tierWindows: {
    cheap: 200_000,
    mid: 1_000_000,
    frontier: 1_000_000,
  },
  // Input pricing ($/1M tokens) of the default models above, used only for the
  // escalation-cost estimate shown in the advisory.
  tierCostPer1M: {
    cheap: 1,
    mid: 3,
    frontier: 5,
  },
  responseHeadroom: 8_000,
  advisoryThreshold: 3,
  // The k-NN scorer is the default routing engine; the heuristic scorer remains as
  // its uncertainty `fallback` target and as a selectable alternative.
  scorer: "knn",
  knn: {
    model: "Xenova/all-MiniLM-L6-v2",
    dimension: 384,
    k: 5,
    // Cosine distance over normalized vectors is in [0, 2]. all-MiniLM-L6-v2 places
    // even closely-related short prompts at ~0.5–0.8, so the "all neighbors too far"
    // gate must sit high or it fires on nearly everything. 0.8 ≈ similarity 0.2 —
    // only genuinely-unrelated prompts (no good neighbor) trip it.
    distanceThreshold: 0.8,
    marginThreshold: 0.15,
    uncertaintyPolicy: "escalate",
  },
};
