import type {
  PromptContext,
  RoutingDecision,
  Scorer,
  SignalContribution,
  Tier,
  Tokenizer,
} from "./types";
import type { ScoringConfig } from "./config";
import {
  containsWord,
  hasCodeBlock,
  hasLargeDiff,
  hasMultipleFiles,
  hasStackTrace,
} from "./signals";

/**
 * Transparent, weighted-sum scorer. This is deliberately the "dumb" version:
 * its job is to be a fully inspectable baseline and to validate everything
 * around it (logging, dispatch, TUI). An embedding-based Scorer can replace it
 * later behind the same interface.
 */
export class HeuristicScorer implements Scorer {
  constructor(
    private readonly config: ScoringConfig,
    private readonly tokenizer: Tokenizer,
  ) {}

  async score(context: PromptContext): Promise<RoutingDecision> {
    const contributions: SignalContribution[] = [];

    // Full text considered for content/keyword signals.
    const text = context.prompt;

    // Token count over the whole context (what will actually be sent).
    const tokenCount =
      this.tokenizer.count(context.system ?? "") +
      context.history.reduce((sum, m) => sum + this.tokenizer.count(m.content), 0) +
      this.tokenizer.count(context.prompt);

    // --- Token bands ---
    for (const band of this.config.tokenBands) {
      if (tokenCount > band.over) {
        contributions.push({
          signal: "token_count",
          detail: `prompt over ${band.over} tokens (${tokenCount})`,
          weight: band.weight,
        });
      }
    }

    // --- Content signals ---
    if (hasStackTrace(text)) {
      contributions.push({
        signal: "stack_trace",
        detail: "stack trace present",
        weight: this.config.content.stackTrace,
      });
    }
    if (hasLargeDiff(text)) {
      contributions.push({
        signal: "large_diff",
        detail: "large diff present",
        weight: this.config.content.largeDiff,
      });
    }
    if (hasMultipleFiles(text)) {
      contributions.push({
        signal: "multi_file",
        detail: "multiple files referenced",
        weight: this.config.content.multiFile,
      });
    }
    if (hasCodeBlock(text)) {
      contributions.push({
        signal: "code_block",
        detail: "code block present",
        weight: this.config.content.codeBlock,
      });
    }

    // --- Keyword signals ---
    for (const { word, weight } of this.config.keywords.raise) {
      if (containsWord(text, word)) {
        contributions.push({
          signal: `keyword:${word}`,
          detail: `mentions "${word}"`,
          weight,
        });
      }
    }
    for (const { word, weight } of this.config.keywords.lower) {
      if (containsWord(text, word)) {
        contributions.push({
          signal: `keyword:${word}`,
          detail: `mentions "${word}" (simple task)`,
          weight: -weight,
        });
      }
    }

    // --- Conversation depth ---
    if (context.history.length > this.config.conversationDepth.turnsOver) {
      contributions.push({
        signal: "conversation_depth",
        detail: `${context.history.length} prior turns`,
        weight: this.config.conversationDepth.weight,
      });
    }

    const score = contributions.reduce((sum, c) => sum + c.weight, 0);

    // Stage 1: complexity alone yields a preferred tier.
    const preferredTier = this.toTier(score);

    // Stage 2: feasibility — the chosen model must be able to hold the context.
    // This may escalate the tier, but never lowers it. Escalation contributions
    // are recorded with weight 0 so they are inspectable without altering the
    // complexity score (preferred tier stays a pure function of complexity).
    const { tier, escalated, exceedsAllWindows } = this.applyFeasibility(
      preferredTier,
      tokenCount,
      contributions,
    );

    return { tier, preferredTier, escalated, exceedsAllWindows, score, contributions, tokenCount };
  }

  private toTier(score: number): Tier {
    const { mid, frontier } = this.config.thresholds;
    if (score >= frontier) return "frontier";
    if (score >= mid) return "mid";
    return "cheap";
  }

  /**
   * Escalate `preferred` to the smallest tier whose model window can hold the
   * context (minus headroom). If no tier can, choose the largest-window tier
   * and flag the overflow. Pushes an inspectable, weight-0 contribution when an
   * escalation or overflow occurs.
   */
  private applyFeasibility(
    preferred: Tier,
    tokenCount: number,
    contributions: SignalContribution[],
  ): { tier: Tier; escalated: boolean; exceedsAllWindows: boolean } {
    const order = TIER_ORDER;
    const { tierWindows, responseHeadroom } = this.config;
    const fits = (t: Tier) => tierWindows[t] - responseHeadroom >= tokenCount;

    // Smallest tier (by escalation order) whose window holds the context.
    const feasible = order.find(fits) ?? null;

    if (feasible === null) {
      // Nothing can hold it — pick the largest window (ties → higher tier).
      const largest = order.reduce((a, b) => (tierWindows[b] >= tierWindows[a] ? b : a));
      contributions.push({
        signal: "context_overflow",
        detail: `context ${tokenCount} tokens exceeds all tier windows (largest ${tierWindows[largest]})`,
        weight: 0,
      });
      return { tier: largest, escalated: false, exceedsAllWindows: true };
    }

    const escalated = order.indexOf(feasible) > order.indexOf(preferred);
    if (escalated) {
      contributions.push({
        signal: "context_escalation",
        detail: `escalated: context ${tokenCount} exceeds ${preferred} window ${tierWindows[preferred]}`,
        weight: 0,
      });
      return { tier: feasible, escalated: true, exceedsAllWindows: false };
    }

    return { tier: preferred, escalated: false, exceedsAllWindows: false };
  }
}

/** Tier escalation order, cheapest first. Shared by feasibility logic. */
const TIER_ORDER: Tier[] = ["cheap", "mid", "frontier"];
