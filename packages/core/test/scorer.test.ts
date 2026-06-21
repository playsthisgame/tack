import { describe, expect, test } from "bun:test";
import {
  ApproxTokenizer,
  defaultConfig,
  HeuristicScorer,
  type PromptContext,
  type ScoringConfig,
} from "../src/index";

const scorer = new HeuristicScorer(defaultConfig, new ApproxTokenizer());

function ctx(prompt: string, history: PromptContext["history"] = []): PromptContext {
  return { prompt, history };
}

// Tiny windows so feasibility can be exercised without huge token counts.
// tokenBands are disabled so a large context does NOT raise complexity — that
// keeps complexity (preferred tier) independent from context-window escalation.
// ApproxTokenizer counts ~1 token per 4 chars.
const feasConfig: ScoringConfig = {
  ...defaultConfig,
  tokenBands: [],
  tierWindows: { cheap: 50, mid: 500, frontier: 1000 },
  responseHeadroom: 10,
  tierCostPer1M: { cheap: 1, mid: 3, frontier: 5 },
  advisoryThreshold: 3,
};
const feasScorer = new HeuristicScorer(feasConfig, new ApproxTokenizer());

/** Plain filler of roughly `tokens` tokens, free of any complexity signals. */
function filler(tokens: number): string {
  return "ab cd ".repeat(Math.ceil((tokens * 4) / 6));
}

describe("HeuristicScorer", () => {
  test("trivial rename routes cheap", async () => {
    const d = await scorer.score(ctx("rename this variable to userId"));
    expect(d.tier).toBe("cheap");
  });

  test("stack trace routes up", async () => {
    const trace = `TypeError: undefined is not a function
    at handleRequest (server.ts:42:13)
    at process (server.ts:11:5)`;
    const d = await scorer.score(ctx(`Why am I getting this?\n${trace}`));
    expect(d.score).toBeGreaterThanOrEqual(defaultConfig.thresholds.mid);
    expect(d.contributions.some((c) => c.signal === "stack_trace")).toBe(true);
  });

  test("architecture request routes frontier", async () => {
    const big = "design ".repeat(10) + "x".repeat(9000);
    const d = await scorer.score(
      ctx(`Help me architect and design a refactor of this module.\n${big}`),
    );
    expect(d.tier).toBe("frontier");
  });

  test("contributions explain the score", async () => {
    const d = await scorer.score(ctx("refactor this typo"));
    // "refactor" (+2) and "typo" (-2) should both appear.
    const signals = d.contributions.map((c) => c.signal);
    expect(signals).toContain("keyword:refactor");
    expect(signals).toContain("keyword:typo");
  });

  test("score equals sum of contributions", async () => {
    const d = await scorer.score(ctx("refactor the architecture and explain why"));
    const sum = d.contributions.reduce((s, c) => s + c.weight, 0);
    expect(d.score).toBe(sum);
  });
});

describe("HeuristicScorer — context-window feasibility", () => {
  test("cheap-preferred + oversized context escalates to mid", async () => {
    // ~50 tokens: over cheap's feasible limit (50 − 10 = 40), under mid's (490).
    const d = await feasScorer.score(ctx(filler(50)));
    expect(d.preferredTier).toBe("cheap");
    expect(d.tier).toBe("mid");
    expect(d.escalated).toBe(true);
    expect(d.exceedsAllWindows).toBe(false);
    expect(d.contributions.some((c) => c.signal === "context_escalation")).toBe(true);
  });

  test("cheap-preferred + small context stays cheap with no escalation", async () => {
    const d = await feasScorer.score(ctx("hello there friend"));
    expect(d.preferredTier).toBe("cheap");
    expect(d.tier).toBe("cheap");
    expect(d.escalated).toBe(false);
    expect(d.contributions.some((c) => c.signal === "context_escalation")).toBe(false);
  });

  test("headroom reserve excludes a near-window-limit context", async () => {
    // ~45 tokens: under the raw cheap window (50) but over window − headroom (40),
    // so it must NOT be treated as fitting cheap.
    const d = await feasScorer.score(ctx(filler(45)));
    expect(d.preferredTier).toBe("cheap");
    expect(d.escalated).toBe(true);
    expect(d.tier).toBe("mid");
  });

  test("context larger than all windows picks the largest tier and flags it", async () => {
    // ~1100 tokens: beyond frontier's feasible limit (1000 − 10 = 990).
    const d = await feasScorer.score(ctx(filler(1100)));
    expect(d.exceedsAllWindows).toBe(true);
    expect(d.tier).toBe("frontier"); // largest window
    expect(d.escalated).toBe(false);
    expect(d.contributions.some((c) => c.signal === "context_overflow")).toBe(true);
  });

  test("escalation contribution carries zero weight (complexity score unchanged)", async () => {
    const d = await feasScorer.score(ctx(filler(50)));
    const sum = d.contributions.reduce((s, c) => s + c.weight, 0);
    expect(d.score).toBe(sum);
    expect(d.score).toBe(0); // no complexity signals fired
  });
});
