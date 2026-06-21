import type { ScoringConfig } from "./config";
import type { Advisory, RoutingDecision, SessionStats } from "./types";

/**
 * Per-session accounting for context-driven escalations.
 *
 * This is deliberately passive: it counts and estimates, and it decides *when*
 * an advisory is worth surfacing — but it never mutates conversation context and
 * never performs (or recommends performing automatically) a compaction. The
 * action and the decision always stay with the user.
 *
 * One tracker is meant to live for the lifetime of a session (e.g. a TUI run).
 * The CLI's single-shot path constructs a throwaway tracker per invocation.
 */
export class SessionTracker {
  private costEscalations = 0;
  private estimatedExtraCost = 0;
  private advised = false;

  constructor(private readonly config: ScoringConfig) {}

  /** A snapshot of the accumulated counters. */
  get stats(): SessionStats {
    return {
      costEscalations: this.costEscalations,
      estimatedExtraCost: this.estimatedExtraCost,
    };
  }

  /**
   * Record one user-turn routing decision. Increments counters only when the
   * escalation was caused by context size (never by complexity). Returns the
   * one-time cost-saving advisory when the configured threshold is first
   * crossed; otherwise null.
   *
   * The blocking (no-feasible-tier) advisory is intentionally NOT produced here
   * — that path does not dispatch and is surfaced via `blockingAdvisory`.
   */
  record(decision: RoutingDecision): Advisory | null {
    if (!decision.escalated) return null;

    this.costEscalations += 1;
    this.estimatedExtraCost += this.escalationCost(decision);

    if (!this.advised && this.costEscalations >= this.config.advisoryThreshold) {
      this.advised = true;
      const saving = this.estimatedExtraCost;
      return {
        kind: "compaction-savings",
        escalations: this.costEscalations,
        estimatedSaving: saving,
        message:
          `${this.costEscalations} prompts have been routed to a costlier tier ` +
          `because the conversation no longer fits the cheaper model. Compacting ` +
          `could restore cheaper routing and save ~$${saving.toFixed(4)} so far.`,
      };
    }
    return null;
  }

  /**
   * Build the blocking advisory for a context that exceeds every tier window.
   * Pure: counters are untouched, since no request is dispatched.
   */
  blockingAdvisory(decision: RoutingDecision): Advisory {
    const largestWindow = Math.max(...Object.values(this.config.tierWindows));
    return {
      kind: "compaction-required",
      tokenCount: decision.tokenCount,
      largestWindow,
      message:
        `Context is ${decision.tokenCount} tokens, larger than every model's ` +
        `window (largest ${largestWindow}). Compact the conversation before ` +
        `retrying — Tack will not drop context on your behalf.`,
    };
  }

  /** Extra spend of one escalation: token count × per-tier price delta. */
  private escalationCost(decision: RoutingDecision): number {
    const final = this.config.tierCostPer1M[decision.tier];
    const preferred = this.config.tierCostPer1M[decision.preferredTier];
    return (decision.tokenCount * Math.max(0, final - preferred)) / 1_000_000;
  }
}
