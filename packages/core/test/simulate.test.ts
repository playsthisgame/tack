import { describe, expect, test } from "bun:test";
import {
  ApproxTokenizer,
  defaultConfig,
  simulateRoute,
  type ScoringConfig,
} from "../src/index";

// Tiny windows + disabled token bands so context-window escalation is isolated
// from complexity (a large context must not also raise the complexity score).
const tinyConfig: ScoringConfig = {
  ...defaultConfig,
  tokenBands: [],
  tierWindows: { cheap: 50, mid: 500, frontier: 1000 },
  responseHeadroom: 10,
  advisoryThreshold: 3,
};

/** Filler of roughly `tokens` tokens (ApproxTokenizer ≈ 1 token / 4 chars). */
function filler(tokens: number): string {
  return "ab cd ".repeat(Math.ceil((tokens * 4) / 6));
}

describe("simulateRoute", () => {
  test("oversized prompts on tiny windows escalate cheap→mid (no complexity bump)", async () => {
    // ~50 tokens: past the cheap feasible limit (50 − 10) but under mid's (500 − 10),
    // and with token bands disabled it does NOT raise complexity, so preferred stays cheap.
    const { turns } = await simulateRoute([filler(50), filler(50)], tinyConfig, {
      tokenizer: new ApproxTokenizer(),
    });
    for (const turn of turns) {
      expect(turn.decision.preferredTier).toBe("cheap");
      expect(turn.decision.tier).toBe("mid");
      expect(turn.decision.escalated).toBe(true);
      expect(turn.dispatched).toBe(true);
    }
  });

  test("cost advisory fires exactly once, on the turn the threshold is crossed", async () => {
    const prompts = [filler(50), filler(50), filler(50), filler(50), filler(50)];
    const { turns, stats } = await simulateRoute(prompts, tinyConfig, {
      tokenizer: new ApproxTokenizer(),
    });

    const advised = turns
      .map((t, i) => ({ i, advisory: t.advisory }))
      .filter((t) => t.advisory?.kind === "compaction-savings");

    expect(advised.length).toBe(1);
    expect(advised[0]!.i).toBe(2); // third turn (threshold = 3)
    expect(stats.costEscalations).toBe(5);
    expect(stats.estimatedExtraCost).toBeGreaterThan(0);
  });

  test("a prompt larger than all windows is blocked, not dispatched", async () => {
    const { turns } = await simulateRoute([filler(2000)], tinyConfig, {
      tokenizer: new ApproxTokenizer(),
    });
    const turn = turns[0]!;
    expect(turn.decision.exceedsAllWindows).toBe(true);
    expect(turn.dispatched).toBe(false);
    expect(turn.advisory?.kind).toBe("compaction-required");
  });

  test("small prompts on real windows neither escalate nor advise", async () => {
    const { turns, stats } = await simulateRoute(["fix typo", "rename x"], defaultConfig, {
      tokenizer: new ApproxTokenizer(),
    });
    for (const turn of turns) {
      expect(turn.decision.escalated).toBe(false);
      expect(turn.advisory).toBeNull();
    }
    expect(stats.costEscalations).toBe(0);
  });

  test("accumulate grows context until it escalates with real-ish windows", async () => {
    // Windows between the per-turn size and the accumulated size: a single ~30-token
    // turn fits cheap, but once history accumulates past the cheap window it escalates.
    const config: ScoringConfig = {
      ...defaultConfig,
      tokenBands: [],
      tierWindows: { cheap: 60, mid: 500, frontier: 1000 },
      responseHeadroom: 0,
    };
    const turn = filler(30);
    const { turns } = await simulateRoute([turn, turn, turn], config, {
      tokenizer: new ApproxTokenizer(),
      accumulate: true,
    });
    expect(turns[0]!.decision.escalated).toBe(false); // ~30 tokens fits cheap (60)
    expect(turns[turns.length - 1]!.decision.escalated).toBe(true); // history pushed it over
  });
});
