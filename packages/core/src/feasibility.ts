import type { SignalContribution, Tier } from "./types";
import { TIER_ORDER } from "./tier";

/** The window sizes and reserve a feasibility check needs (a subset of `ScoringConfig`). */
export interface TierWindows {
  /** Context-window size (tokens) of each tier's model. */
  tierWindows: Record<Tier, number>;
  /** Tokens reserved out of each window for the response. */
  responseHeadroom: number;
}

export interface FeasibilityResult {
  /** The tier after the window check — `preferred`, an escalation, or the largest-window tier. */
  tier: Tier;
  /** True when `tier` was raised above `preferred` solely to fit the context window. */
  escalated: boolean;
  /** True when no tier's window can hold the context; `tier` is then the largest-window tier. */
  exceedsAllWindows: boolean;
}

/**
 * Context-window feasibility — the second stage of routing, shared by every scorer.
 * A scorer first picks a tier from complexity/semantics; this then ensures the chosen
 * model can actually hold the context, escalating to the smallest tier whose window
 * fits (minus headroom) or, if nothing fits, flagging overflow so dispatch can block.
 *
 * It never lowers a tier — a complexity/semantic tier is a floor. Escalation and
 * overflow are recorded as weight-0 contributions so they are inspectable without
 * perturbing the complexity score (which stays a pure function of the scorer's signal).
 */
export function applyFeasibility(
  preferred: Tier,
  tokenCount: number,
  windows: TierWindows,
  contributions: SignalContribution[],
): FeasibilityResult {
  const order = TIER_ORDER;
  const { tierWindows, responseHeadroom } = windows;
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
