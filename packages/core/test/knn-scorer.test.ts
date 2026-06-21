import { describe, expect, test } from "bun:test";
import {
  ApproxTokenizer,
  defaultConfig,
  KnnScorer,
  type Embedder,
  type EmbeddedExample,
  type KnnConfig,
  type PromptContext,
  type RoutingDecision,
  type Scorer,
  type ScoringConfig,
  type Tier,
} from "../src/index";

// The query always sits at [1, 0]; a labeled example at cosine distance `d` is the
// unit vector [1 − d, sqrt(1 − (1 − d)^2)], so we dial each neighbor's distance
// exactly and control the weighted vote deterministically.
const QUERY = new Float32Array([1, 0]);

class QueryEmbedder implements Embedder {
  readonly model = "fake-v1";
  readonly dimension = 2;
  async embed(): Promise<Float32Array> {
    return QUERY;
  }
}

function vecAtDistance(d: number): Float32Array {
  const cos = 1 - d;
  return new Float32Array([cos, Math.sqrt(Math.max(0, 1 - cos * cos))]);
}

let nextId = 0;
function ex(tier: Tier, distance: number): EmbeddedExample {
  return {
    id: `e${nextId++}`,
    prompt: `${tier}@${distance}`,
    tier,
    source: "seed",
    embedding: vecAtDistance(distance),
    model: "fake-v1",
  };
}

function cfg(knn: Partial<KnnConfig>): ScoringConfig {
  return {
    ...defaultConfig,
    scorer: "knn",
    knn: {
      model: "fake-v1",
      dimension: 2,
      k: 5,
      distanceThreshold: 0.4,
      marginThreshold: 0.15,
      uncertaintyPolicy: "escalate",
      ...knn,
    },
  };
}

/** A stand-in scorer for the fallback path; always returns `tier`. */
function fallback(tier: Tier): Scorer {
  return {
    score: async (): Promise<RoutingDecision> => ({
      tier,
      preferredTier: tier,
      escalated: false,
      exceedsAllWindows: false,
      score: 0,
      contributions: [{ signal: "heuristic", detail: "fallback chose " + tier, weight: 0 }],
      tokenCount: 0,
      confidence: 0.5,
      neighbors: [],
    }),
  };
}

const ctx: PromptContext = { prompt: "anything", history: [] };

function makeScorer(labeledSet: EmbeddedExample[], config: ScoringConfig, fb?: Scorer): KnnScorer {
  return new KnnScorer({
    embedder: new QueryEmbedder(),
    labeledSet,
    config,
    tokenizer: new ApproxTokenizer(),
    fallbackScorer: fb,
  });
}

describe("KnnScorer — voting", () => {
  test("nearest neighbors decide the tier", async () => {
    const set = [ex("frontier", 0.1), ex("frontier", 0.1), ex("frontier", 0.1), ex("cheap", 0.3), ex("cheap", 0.3)];
    const d = await makeScorer(set, cfg({ k: 5 })).score(ctx);
    expect(d.tier).toBe("frontier");
    expect(d.uncertain).toBeFalsy();
    expect(d.neighbors).toHaveLength(5);
  });

  test("distance weighting lets one very-close neighbor outweigh more numerous distant ones", async () => {
    // 1 very-close frontier vs 4 distant cheap — cheap wins by count, frontier by weight.
    const set = [ex("frontier", 0.01), ex("cheap", 0.3), ex("cheap", 0.3), ex("cheap", 0.3), ex("cheap", 0.3)];
    const d = await makeScorer(set, cfg({ k: 5 })).score(ctx);
    expect(d.tier).toBe("frontier");
  });

  test("the decision reports its neighbors with tiers and distances", async () => {
    const set = [ex("frontier", 0.1), ex("cheap", 0.3)];
    const d = await makeScorer(set, cfg({ k: 2 })).score(ctx);
    expect(d.neighbors[0]!.distance).toBeCloseTo(0.1, 5);
    expect(d.neighbors[0]!.tier).toBe("frontier");
    expect(d.confidence).toBeGreaterThan(0);
  });
});

describe("KnnScorer — uncertainty policy", () => {
  test("far neighbors escalate one tier under the escalate policy", async () => {
    const set = [ex("cheap", 0.5), ex("cheap", 0.5), ex("cheap", 0.5)];
    const d = await makeScorer(set, cfg({ k: 3, uncertaintyPolicy: "escalate" })).score(ctx);
    expect(d.uncertain).toBe(true);
    // Uncertainty escalation raises the semantic tier (the scorer's preference); the
    // one-tier-up is recorded inspectably. `escalated` is reserved for context-window
    // escalation, which did not occur here (tiny context).
    expect(d.tier).toBe("mid");
    expect(d.preferredTier).toBe("mid");
    expect(d.escalated).toBe(false);
    expect(
      d.contributions.some((c) => c.signal === "knn_escalation" && c.detail.includes("cheap → mid")),
    ).toBe(true);
  });

  test("a close vote falls back to the heuristic scorer under the fallback policy", async () => {
    // One frontier and one cheap at equal distance → margin 0 → uncertain.
    const set = [ex("frontier", 0.1), ex("cheap", 0.1)];
    const d = await makeScorer(set, cfg({ k: 2, uncertaintyPolicy: "fallback" }), fallback("mid")).score(ctx);
    expect(d.uncertain).toBe(true);
    expect(d.tier).toBe("mid");
    expect(d.contributions.some((c) => c.signal === "knn_fallback")).toBe(true);
  });

  test("empty labeled set applies the policy rather than crashing", async () => {
    const escalated = await makeScorer([], cfg({ uncertaintyPolicy: "escalate" })).score(ctx);
    expect(escalated.uncertain).toBe(true);
    expect(escalated.tier).toBe("mid"); // escalate from the cheap baseline
    expect(escalated.neighbors).toEqual([]);
    expect(escalated.contributions.some((c) => c.signal === "knn_no_examples")).toBe(true);

    const fellBack = await makeScorer([], cfg({ uncertaintyPolicy: "fallback" }), fallback("cheap")).score(ctx);
    expect(fellBack.tier).toBe("cheap");
  });
});

describe("KnnScorer — config-driven k", () => {
  test("changing k changes the outcome with no code change", async () => {
    // Closest is frontier; the next four are cheap and outweigh it only once included.
    const set = [ex("frontier", 0.1), ex("cheap", 0.2), ex("cheap", 0.2), ex("cheap", 0.2), ex("cheap", 0.2)];
    const atK1 = await makeScorer(set, cfg({ k: 1 })).score(ctx);
    const atK5 = await makeScorer(set, cfg({ k: 5 })).score(ctx);
    expect(atK1.tier).toBe("frontier");
    expect(atK5.tier).toBe("cheap");
  });
});
