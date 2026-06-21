import { describe, expect, test } from "bun:test";
import {
  defaultConfig,
  SessionTracker,
  type RoutingDecision,
  type ScoringConfig,
  type Tier,
} from "../src/index";

const config: ScoringConfig = {
  ...defaultConfig,
  tierWindows: { cheap: 50, mid: 500, frontier: 1000 },
  tierCostPer1M: { cheap: 1, mid: 3, frontier: 5 },
  advisoryThreshold: 3,
};

function decision(
  partial: Partial<RoutingDecision> & { tier: Tier; preferredTier: Tier },
): RoutingDecision {
  return {
    score: 0,
    contributions: [],
    tokenCount: 1_000_000, // 1M tokens makes the per-1M cost delta easy to read
    escalated: partial.tier !== partial.preferredTier,
    exceedsAllWindows: false,
    ...partial,
  };
}

describe("SessionTracker", () => {
  test("counts only context-driven escalations, not complexity routing", () => {
    const t = new SessionTracker(config);

    // Complexity-driven mid (escalated: false) — must not count.
    t.record(decision({ tier: "mid", preferredTier: "mid", escalated: false }));
    expect(t.stats.costEscalations).toBe(0);
    expect(t.stats.estimatedExtraCost).toBe(0);

    // Context-driven escalation cheap → mid — counts.
    t.record(decision({ tier: "mid", preferredTier: "cheap" }));
    expect(t.stats.costEscalations).toBe(1);
    // 1M tokens × ($3 − $1)/1M = $2.
    expect(t.stats.estimatedExtraCost).toBeCloseTo(2, 6);
  });

  test("advisory fires exactly once at the threshold and acts on nothing", () => {
    const t = new SessionTracker(config);
    const esc = () => decision({ tier: "mid", preferredTier: "cheap" });

    expect(t.record(esc())).toBeNull(); // 1
    expect(t.record(esc())).toBeNull(); // 2
    const advisory = t.record(esc()); // 3 — threshold reached
    expect(advisory).not.toBeNull();
    expect(advisory!.kind).toBe("compaction-savings");

    // Fires once only; further escalations still count but surface no new advisory.
    expect(t.record(esc())).toBeNull(); // 4
    expect(t.stats.costEscalations).toBe(4);
  });

  test("blockingAdvisory reports the overflow without touching counters", () => {
    const t = new SessionTracker(config);
    const d = decision({
      tier: "frontier",
      preferredTier: "cheap",
      escalated: false,
      exceedsAllWindows: true,
      tokenCount: 1_500,
    });
    const advisory = t.blockingAdvisory(d);
    expect(advisory.kind).toBe("compaction-required");
    if (advisory.kind === "compaction-required") {
      expect(advisory.tokenCount).toBe(1_500);
      expect(advisory.largestWindow).toBe(1_000);
    }
    expect(t.stats.costEscalations).toBe(0);
  });
});
