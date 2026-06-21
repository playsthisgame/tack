# Embedding-Based k-NN Scorer

## Why

Tack's current scorer is a heuristic weighted-sum over surface signals (token
count, stack-trace presence, diff detection, keyword matching). It is inspectable
and tunable, but keyword matching cannot see *semantic* complexity: "rename this
variable" and "find the race condition that only appears under load" may share no
keywords with the seeds that should match them, and a casually phrased hard problem
slips through entirely.

This change adds a second `Scorer` implementation that routes by semantic
similarity: embed the incoming prompt locally, compare it against a set of
hand-labeled example prompts, and let the nearest neighbors vote on the tier. It is
designed to preserve — not sacrifice — Tack's core commitments:

- **Inspectable:** the explanation *is* the mechanism. A decision reports the
  actual nearest labeled prompts and their distances, not an opaque score.
- **Tunable:** "training" is editing the labeled set. Add or relabel an example and
  recompute its embedding — no model retraining.
- **Local and free on the hot path:** embeddings run on-device so routing stays
  fast, private, and offline. (A paid API-embedding backend is a future change.)

This slots in behind the existing `Scorer` interface as an alternative
implementation. The heuristic scorer remains; selecting between them is config.

## What Changes

- Add a local embedding provider behind an `Embedder` interface: `embed(text) ->
  Float32Array`. Initial implementation uses `transformers.js` with
  `Xenova/all-MiniLM-L6-v2` (384 dims). The model name and dimension are recorded
  alongside every embedding produced.
- Add a labeled-example data model (`LabeledExample`, `EmbeddedExample`) and a seed
  file format (`SeedFile`) carrying `model`, `dimension`, `version`, and an
  `examples[]` array of `{ id, prompt, tier, source }`.
- Ship an **empty** `seeds.json` (valid structure, `examples: []`). Seed content is
  curated separately and added by hand; the build must not fail on an empty set.
- Add a loader that reads the shipped seed file and the user's own labeled examples
  (from the existing `bun:sqlite` log DB, `source: "user"`), validates that every
  example's `model`/`dimension` matches the active embedder, embeds any examples
  missing a cached vector, and merges both sources into one in-memory labeled set.
  User labels take precedence over seed labels on conflict.
- Add a cosine-distance function over `Float32Array` vectors.
- Add a `KnnScorer` implementing `Scorer`: embed the prompt, scan all labeled
  vectors, take the top-k nearest, and vote with **distance-weighted** votes
  (closer neighbors count more) to select a tier.
- The `Scorer` result carries `{ tier, confidence, neighbors }`, where `neighbors`
  lists the top-k `{ id, prompt, tier, distance }`. `confidence` is derived from
  the vote margin and the absolute distance of the nearest neighbors.
- Add an **uncertainty policy**: when the nearest neighbors are all far (above a
  configured distance threshold) or the weighted vote is close (margin below a
  configured threshold), the result is flagged `uncertain`. Policy on uncertainty
  is configurable: `escalate` one tier (safer/costlier) or `fallback` to the
  heuristic scorer. Default: `escalate`.
- Surface neighbors, distances, confidence, and any uncertainty/escalation in the
  `tack score` output, consistent with the existing inspectable-decision format.
- Scorer selection (`heuristic` | `knn`) and all thresholds (`k`,
  `distanceThreshold`, `marginThreshold`, `uncertaintyPolicy`) live in config,
  never hardcoded.

## Out of Scope

- **API-based embeddings.** A hosted embedding backend is a future paid feature;
  this change ships local-only. The `Embedder` interface must keep that swap clean.
- **Approximate-nearest-neighbor indexing** (HNSW etc.). Brute-force scan is
  correct and fast at the seed-set scale; an ANN index is a later optimization.
- **Auto-harvesting** labeled examples from routing logs. The `source` field is
  extensible (`"seed" | "user"`, room for `"harvested"`) but mining is not built
  here.
- **Curating the seed content.** This change ships an empty, valid `seeds.json`;
  examples are added by hand afterward.
- **Removing or replacing the heuristic scorer.** It remains as a selectable
  implementation and as the `fallback` target.

## Impact

- Affected: `@tack/core` (new `Embedder`, `KnnScorer`, labeled-example types, seed
  loader, distance fn, config additions), `@tack/cli` (`tack score` output),
  package data (`seeds.json`), and a new `transformers.js` dependency.
- The `Scorer` interface gains `confidence` and `neighbors` on its result type;
  the heuristic scorer must be updated to populate them (neighbors empty,
  confidence derived from its own signal strength) so both satisfy one contract.
