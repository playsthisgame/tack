# Tasks: Embedding-Based k-NN Scorer

## Data model & seed file
- [x] Define `Tier` as a shared type (reused by both scorers), if not already shared.
- [x] Define `LabeledExample` (`id`, `prompt`, `tier`, `source`) with
      `source: "seed" | "user"` as an extensible union.
- [x] Define `EmbeddedExample` extending `LabeledExample` with
      `embedding: Float32Array` and `model: string`.
- [x] Define `SeedFile` (`model`, `dimension`, `version`, `examples`).
- [x] Ship an **empty but valid** `seeds.json`
      (`model`, `dimension`, `version`, `examples: []`). Do not generate content.

## Embedder
- [x] Define the `Embedder` interface: `embed(text) -> Float32Array`, plus exposed
      `model` and `dimension`.
- [x] Implement a `transformers.js` embedder using `Xenova/all-MiniLM-L6-v2`.
- [x] Ensure the model loads once and is reused; no network on the hot path after load.
- [x] Tag every produced embedding with model name and dimension.

## Loader
- [x] Load the shipped seed file; tolerate an empty `examples` array.
- [x] Load user labeled examples (`source: "user"`) from the `bun:sqlite` log DB.
- [x] Compute and cache embeddings for any example missing a vector.
- [x] Re-embed any example whose recorded `model`/`dimension` differs from the
      active embedder's; never compare cross-model vectors.
- [x] Merge seed + user sets into one in-memory labeled set; user label wins on conflict.

## Distance
- [x] Implement cosine similarity / distance over `Float32Array`.
- [x] Reject differing-length inputs with an error.

## k-NN scorer
- [x] Implement `KnnScorer` satisfying the `Scorer` interface.
- [x] Embed prompt, scan all labeled vectors, select top-`k` (from config).
- [x] Compute a **distance-weighted** vote (closer neighbors weigh more).
- [x] Return `{ tier, confidence, neighbors }`; `neighbors` = top-`k`
      `{ id, prompt, tier, distance }`.
- [x] Derive `confidence` from vote margin and nearest-neighbor distances.
- [x] Handle the empty-labeled-set case by reporting "cannot decide" and applying
      the uncertainty policy.

## Uncertainty policy
- [x] Flag `uncertain` when nearest neighbors all exceed `distanceThreshold` or the
      vote margin is below `marginThreshold`.
- [x] Implement `escalate` (one tier up) and `fallback` (defer to heuristic scorer);
      default `escalate`.
- [x] Record every escalation/fallback as an inspectable contribution.

## Scorer contract alignment
- [x] Extend the shared `Scorer` result type with `confidence` and `neighbors`.
- [x] Update the heuristic scorer to populate them (empty `neighbors`, confidence
      from its own signal strength) so both honor one contract.

## Config
- [x] Add scorer selection (`heuristic` | `knn`).
- [x] Add `k`, `distanceThreshold`, `marginThreshold`, `uncertaintyPolicy`.
- [x] No threshold or selection hardcoded.

## CLI
- [x] Extend `tack score` output to show neighbors, distances, confidence, and any
      uncertainty/escalation/fallback, consistent with the existing inspectable format.

## Tests
- [x] Empty `seeds.json` loads with zero examples and no error.
- [x] Embedder returns a 384-dim vector tagged with the right model.
- [x] Cosine distance: identical vectors ≈ 1.0; length mismatch errors.
- [x] Loader re-embeds on model mismatch; never compares cross-model vectors.
- [x] User label overrides seed label on conflict.
- [x] k-NN selects the tier of the dominant nearby neighbors.
- [x] Distance weighting can let a single very-close neighbor outweigh more
      numerous distant ones.
- [x] Far neighbors escalate under `escalate` policy; close vote falls back under
      `fallback` policy.
- [x] Empty labeled set applies the uncertainty policy rather than crashing.
- [x] Changing `k` in config changes behavior with no code change.
