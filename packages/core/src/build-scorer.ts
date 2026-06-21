import type { ScoringConfig } from "./config";
import { HeuristicScorer } from "./scorer";
import { KnnScorer } from "./knn-scorer";
import { TransformersEmbedder } from "./embedder";
import { BpeTokenizer } from "./tokenizer";
import { loadLabeledSet } from "./loader";
import type { LabeledExampleStore } from "./labeled-store";
import type { Embedder, Scorer, SeedFile, Tokenizer } from "./types";

export interface BuildScorerOptions {
  /** Tokenizer for context sizing. Defaults to `BpeTokenizer`. */
  tokenizer?: Tokenizer;
  /** Embedder for the k-NN scorer. Defaults to a `TransformersEmbedder` from `config.knn`. */
  embedder?: Embedder;
  /** User labeled-example store, merged into the k-NN labeled set. Optional (seed-only without it). */
  store?: LabeledExampleStore;
  /** Seed examples. Defaults to the shipped `seeds.json`. */
  seedFile?: SeedFile;
}

/**
 * Construct the scorer the config selects — the single place that maps
 * `config.scorer` to a concrete `Scorer`, so the CLI, dispatcher, TUI, and route
 * simulation all resolve it the same way.
 *
 * The heuristic scorer is synchronous to build. The k-NN scorer is async: it loads
 * the local embedder and the merged labeled set (seeds + the user's own), and is
 * wired with the heuristic scorer as its `fallback` target. Building is awaited once
 * and the result is meant to be reused (the embedding model loads on first use).
 */
export async function buildScorer(
  config: ScoringConfig,
  opts: BuildScorerOptions = {},
): Promise<Scorer> {
  const tokenizer = opts.tokenizer ?? new BpeTokenizer();
  const heuristic = new HeuristicScorer(config, tokenizer);
  if (config.scorer !== "knn") return heuristic;

  const embedder =
    opts.embedder ?? new TransformersEmbedder(config.knn.model, config.knn.dimension);
  const labeledSet = await loadLabeledSet({
    embedder,
    store: opts.store,
    seedFile: opts.seedFile,
  });
  return new KnnScorer({ embedder, labeledSet, config, tokenizer, fallbackScorer: heuristic });
}
