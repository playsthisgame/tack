import type { ScoringConfig } from "./config";
import { cosineDistance } from "./distance";
import { applyFeasibility } from "./feasibility";
import { nextTier } from "./tier";
import type {
  Embedder,
  EmbeddedExample,
  Neighbor,
  PromptContext,
  RoutingDecision,
  Scorer,
  SignalContribution,
  Tier,
  Tokenizer,
} from "./types";

/** Avoids division by zero when a neighbor sits exactly on the prompt. */
const EPSILON = 1e-6;

export interface KnnScorerOptions {
  /** Embeds the incoming prompt. Must be the same model the labeled set was embedded with. */
  embedder: Embedder;
  /** The labeled set to vote over, already embedded under `embedder`'s model. */
  labeledSet: EmbeddedExample[];
  /** Routing config; supplies the k-NN block plus tier metadata. */
  config: ScoringConfig;
  /** Counts tokens for the decision's `tokenCount` (parity with the heuristic scorer). */
  tokenizer: Tokenizer;
  /**
   * The scorer to defer to under the `fallback` uncertainty policy. Required only if
   * that policy is configured; without it, fallback degrades to escalation.
   */
  fallbackScorer?: Scorer;
}

/**
 * Routes by semantic similarity. The prompt is embedded, compared against every
 * labeled example, and the `k` nearest vote — weighted by closeness — on the tier.
 * The decision reports the actual nearest prompts and their distances, so the
 * explanation IS the mechanism, not an opaque score.
 *
 * "Training" this scorer is editing its labeled set; no model is retrained.
 */
export class KnnScorer implements Scorer {
  constructor(private readonly opts: KnnScorerOptions) {}

  async score(context: PromptContext): Promise<RoutingDecision> {
    const { embedder, labeledSet, config, tokenizer } = this.opts;
    const { k, distanceThreshold, marginThreshold } = config.knn;

    const tokenCount =
      tokenizer.count(context.system ?? "") +
      context.history.reduce((sum, m) => sum + tokenizer.count(m.content), 0) +
      tokenizer.count(context.prompt);

    const contributions: SignalContribution[] = [];
    let neighbors: Neighbor[] = [];
    let confidence = 0;
    let uncertain = false;
    // The semantic tier, before the context-window feasibility stage.
    let preferredTier: Tier;

    if (labeledSet.length === 0) {
      // Empty labeled set: the scorer cannot decide. Report that and let the
      // uncertainty policy choose a tier rather than crashing.
      contributions.push({
        signal: "knn_no_examples",
        detail: "labeled set is empty — cannot decide",
        weight: 0,
      });
      uncertain = true;
      preferredTier = await this.applyPolicy("cheap", context, contributions);
    } else {
      // Embed and rank every labeled example by cosine distance (nearest first).
      const queryVec = await embedder.embed(context.prompt);
      const top = labeledSet
        .map((ex) => ({ ex, distance: cosineDistance(queryVec, ex.embedding) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, k);

      neighbors = top.map(({ ex, distance }) => ({
        id: ex.id,
        prompt: ex.prompt,
        tier: ex.tier,
        distance,
      }));

      // Distance-weighted vote: a closer neighbor (smaller distance) counts more, so a
      // single very-close neighbor can outweigh several distant ones.
      const weightByTier = new Map<Tier, number>();
      let totalWeight = 0;
      for (const { ex, distance } of top) {
        const w = 1 / (distance + EPSILON);
        weightByTier.set(ex.tier, (weightByTier.get(ex.tier) ?? 0) + w);
        totalWeight += w;
      }

      const sorted = [...weightByTier.entries()].sort((a, b) => b[1] - a[1]);
      const votedTier = sorted[0]![0];
      const winnerWeight = sorted[0]![1];
      const runnerUpWeight = sorted[1]?.[1] ?? 0;
      const margin = totalWeight > 0 ? (winnerWeight - runnerUpWeight) / totalWeight : 0;

      // Each neighbor is an inspectable contribution carrying its share of the vote.
      for (const { ex, distance } of top) {
        contributions.push({
          signal: `neighbor:${ex.id}`,
          detail: `"${snippet(ex.prompt)}" → ${ex.tier} (distance ${distance.toFixed(3)})`,
          weight: totalWeight > 0 ? Number((1 / (distance + EPSILON) / totalWeight).toFixed(3)) : 0,
        });
      }

      // Confidence: a decisive vote (large margin) among near neighbors (small nearest
      // distance) is confident; a close vote or only-distant neighbors is not.
      const nearestDistance = neighbors[0]!.distance;
      const proximity = Math.max(0, Math.min(1, 1 - nearestDistance));
      confidence = Number((margin * proximity).toFixed(3));

      // Uncertain when every neighbor is far, or the vote is too close to call.
      const allFar = neighbors.every((n) => n.distance > distanceThreshold);
      const closeVote = margin < marginThreshold;
      if (allFar || closeVote) {
        uncertain = true;
        contributions.push({
          signal: "knn_uncertain",
          detail: allFar
            ? `nearest neighbors all exceed distance threshold ${distanceThreshold}`
            : `vote margin ${margin.toFixed(3)} below threshold ${marginThreshold}`,
          weight: 0,
        });
        preferredTier = await this.applyPolicy(votedTier, context, contributions);
      } else {
        preferredTier = votedTier;
      }
    }

    // Second stage, shared with the heuristic scorer: ensure the chosen tier's model
    // can hold the context, escalating to fit or flagging overflow so dispatch blocks.
    const { tier, escalated, exceedsAllWindows } = applyFeasibility(
      preferredTier,
      tokenCount,
      config,
      contributions,
    );

    return {
      tier,
      preferredTier,
      escalated,
      exceedsAllWindows,
      score: confidence,
      contributions,
      tokenCount,
      confidence,
      neighbors,
      uncertain,
    };
  }

  /**
   * Resolve an uncertain vote into a semantic tier via the configured policy, and
   * record the override as an inspectable contribution. `fallback` defers to the
   * heuristic scorer (when supplied); otherwise — the default — escalate one tier up
   * (safer, costlier).
   */
  private async applyPolicy(
    votedTier: Tier,
    context: PromptContext,
    contributions: SignalContribution[],
  ): Promise<Tier> {
    const policy = this.opts.config.knn.uncertaintyPolicy;

    if (policy === "fallback" && this.opts.fallbackScorer) {
      const fb = await this.opts.fallbackScorer.score(context);
      contributions.push({
        signal: "knn_fallback",
        detail: `uncertain → fell back to heuristic scorer (chose ${fb.tier})`,
        weight: 0,
      });
      return fb.tier;
    }

    const escalatedTier = nextTier(votedTier);
    contributions.push({
      signal: "knn_escalation",
      detail: `uncertain → escalated ${votedTier} → ${escalatedTier}`,
      weight: 0,
    });
    return escalatedTier;
  }
}

/** Trim a prompt to a one-line preview for inspectable output. */
function snippet(prompt: string, max = 48): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
