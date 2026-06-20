import type { Tier } from "./types";

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
};
