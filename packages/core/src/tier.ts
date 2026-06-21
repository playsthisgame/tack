import type { Tier } from "./types";

/** Tier escalation order, cheapest first. The single source of truth for "one tier up". */
export const TIER_ORDER: Tier[] = ["cheap", "mid", "frontier"];

/**
 * The next tier up from `tier` (safer/costlier), saturating at `frontier`. Used by
 * the uncertainty `escalate` policy and the heuristic feasibility check.
 */
export function nextTier(tier: Tier): Tier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(i + 1, TIER_ORDER.length - 1)]!;
}
