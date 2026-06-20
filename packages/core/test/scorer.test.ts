import { describe, expect, test } from "bun:test";
import {
  ApproxTokenizer,
  defaultConfig,
  HeuristicScorer,
  type PromptContext,
} from "../src/index";

const scorer = new HeuristicScorer(defaultConfig, new ApproxTokenizer());

function ctx(prompt: string, history: PromptContext["history"] = []): PromptContext {
  return { prompt, history };
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
