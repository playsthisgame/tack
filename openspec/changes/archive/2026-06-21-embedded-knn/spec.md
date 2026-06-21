# Spec Delta: Embedding-Based k-NN Scorer

## ADDED Requirements

### Requirement: Local embedding provider

Tack SHALL provide an `Embedder` interface exposing `embed(text: string) ->
Float32Array`. The initial implementation SHALL run locally via `transformers.js`
using `Xenova/all-MiniLM-L6-v2` and SHALL NOT make network calls on the routing
hot path after the model is available.

Every embedding the provider produces SHALL be associated with the model name and
dimension that produced it.

#### Scenario: Embedding a prompt

- **GIVEN** an initialized local embedder
- **WHEN** `embed("rename this variable")` is called
- **THEN** a 384-element `Float32Array` is returned
- **AND** the result is tagged with model `Xenova/all-MiniLM-L6-v2` and dimension 384

#### Scenario: No network on the hot path

- **GIVEN** the embedding model is already available locally
- **WHEN** a prompt is embedded during routing
- **THEN** no network request is made

### Requirement: Labeled-example data model and seed file

Tack SHALL define `LabeledExample` (`id`, `prompt`, `tier`, `source`) and
`EmbeddedExample` (extends `LabeledExample` with `embedding: Float32Array` and
`model: string`). The seed file SHALL carry `model`, `dimension`, `version`, and
`examples: LabeledExample[]`.

Tack SHALL ship a structurally valid `seeds.json` whose `examples` array MAY be
empty. An empty seed set SHALL NOT cause loading or build to fail.

#### Scenario: Empty seed file loads cleanly

- **GIVEN** a `seeds.json` with `examples: []`
- **WHEN** the loader runs
- **THEN** loading succeeds with zero seed examples
- **AND** no error is raised

#### Scenario: Authored fields only

- **GIVEN** a seed example in the file
- **THEN** it contains exactly `id`, `prompt`, `tier`, and `source`
- **AND** it contains no embedding vector (vectors are derived, never authored)

### Requirement: Labeled-set loader with model guard and provenance merge

Tack SHALL load labeled examples from the shipped seed file and from the user's
labeled examples in the `bun:sqlite` log DB (`source: "user"`), and merge them into
a single in-memory set. For any example lacking a cached vector, the loader SHALL
compute and cache its embedding using the active embedder.

If an example's recorded `model` or `dimension` does not match the active
embedder's, the loader SHALL recompute that example's embedding rather than compare
incompatible vectors.

On a labeling conflict between a `seed` and a `user` example for equivalent prompt
content, the `user` label SHALL take precedence.

#### Scenario: Model mismatch triggers re-embedding

- **GIVEN** a cached example tagged with a different embedding model
- **WHEN** the loader processes it under the active embedder
- **THEN** the example is re-embedded with the active model
- **AND** no distance is ever computed between vectors from different models

#### Scenario: User label overrides seed label

- **GIVEN** a seed example labeled `mid`
- **AND** a user example for equivalent content labeled `frontier`
- **WHEN** the merged set is built
- **THEN** the effective label for that content is `frontier`

### Requirement: Cosine distance over embeddings

Tack SHALL provide a distance function computing cosine similarity (or its distance
complement) between two equal-length `Float32Array` vectors. It SHALL reject inputs
of differing length.

#### Scenario: Identical vectors

- **GIVEN** two identical vectors
- **WHEN** distance is computed
- **THEN** similarity is approximately 1.0

#### Scenario: Length mismatch rejected

- **GIVEN** vectors of differing length
- **WHEN** distance is computed
- **THEN** an error is raised rather than a silent result

### Requirement: k-NN scorer with distance-weighted voting

Tack SHALL provide a `KnnScorer` implementing the `Scorer` interface. It SHALL
embed the prompt, compute distance to every labeled example, select the `k` nearest
(`k` from config), and select a tier by **distance-weighted** vote, where closer
neighbors contribute more weight than farther ones.

#### Scenario: Nearest neighbors decide the tier

- **GIVEN** a labeled set and `k = 5`
- **WHEN** a prompt is scored whose 5 nearest examples are mostly `frontier`
- **THEN** the selected tier is `frontier`

#### Scenario: Distance weighting over raw counts

- **GIVEN** `k` neighbors where the majority by count are `cheap` but the single
  closest neighbor is much nearer and `frontier`
- **WHEN** the weighted vote is computed
- **THEN** the closer `frontier` neighbor's weight can outweigh the more numerous
  but distant `cheap` neighbors

#### Scenario: Empty labeled set

- **GIVEN** a labeled set with zero examples
- **WHEN** a prompt is scored with the k-NN scorer
- **THEN** the scorer reports it cannot decide
- **AND** the configured uncertainty policy is applied (escalate or fallback)

### Requirement: Inspectable scorer result

The `Scorer` result SHALL carry `tier`, `confidence`, and `neighbors`, where
`neighbors` is the top-`k` list of `{ id, prompt, tier, distance }`. `confidence`
SHALL be derived from the weighted-vote margin and the absolute distance of the
nearest neighbors.

The heuristic scorer SHALL also satisfy this result shape (empty `neighbors`,
`confidence` derived from its own signal strength) so both implementations honor one
contract.

#### Scenario: Decision reports its neighbors

- **GIVEN** a prompt scored by the k-NN scorer
- **WHEN** the decision is inspected via `tack score`
- **THEN** the output lists the nearest labeled prompts, their tiers, and distances
- **AND** shows the resulting confidence

### Requirement: Uncertainty policy

When the nearest neighbors are all farther than a configured `distanceThreshold`,
or the weighted-vote margin is below a configured `marginThreshold`, the result
SHALL be flagged `uncertain`. On uncertainty Tack SHALL apply the configured
`uncertaintyPolicy`: `escalate` (select one tier higher than the vote indicates) or
`fallback` (defer to the heuristic scorer). The default SHALL be `escalate`.

Every escalation or fallback SHALL appear as an inspectable contribution in the
decision output.

#### Scenario: Far neighbors escalate

- **GIVEN** `uncertaintyPolicy: "escalate"`
- **AND** a prompt whose nearest neighbors all exceed `distanceThreshold`
- **WHEN** it is scored
- **THEN** the result is flagged uncertain
- **AND** the tier is raised one level above the weighted vote
- **AND** the decision records why it was escalated

#### Scenario: Close vote with fallback policy

- **GIVEN** `uncertaintyPolicy: "fallback"`
- **AND** a prompt whose weighted vote margin is below `marginThreshold`
- **WHEN** it is scored
- **THEN** the heuristic scorer decides the tier
- **AND** the decision records that it fell back

### Requirement: Configurable scorer selection and thresholds

Scorer selection (`heuristic` | `knn`) and all k-NN parameters (`k`,
`distanceThreshold`, `marginThreshold`, `uncertaintyPolicy`) SHALL live in
configuration. None SHALL be hardcoded.

#### Scenario: Selecting the k-NN scorer

- **GIVEN** config sets the scorer to `knn`
- **WHEN** Tack routes a prompt
- **THEN** the k-NN scorer produces the decision

#### Scenario: Tuning k without code change

- **GIVEN** `k` is changed in config
- **WHEN** Tack next routes a prompt
- **THEN** the new `k` is used with no code modification
