# Tack

Tack is a local-first AI prompt router. It inspects each prompt before it is sent
to a model, scores its complexity using fast local heuristics, and routes it to
the most cost-effective model capable of handling it well.

## The Problem

Developers using AI coding tools pay per token, and most send every prompt to a
frontier model regardless of difficulty. A request to rename a variable costs the
same model time as architecting a subsystem. Cheaper models handle the easy
majority of prompts at parity quality, but choosing the right model manually for
every prompt is impractical. Tack automates that choice.

## Goals

- Reduce token spend by routing easy prompts to cheaper models, hard prompts to
  frontier models, with no perceptible quality loss on the hard cases.
- Make every routing decision fully inspectable and tunable. The user can always
  see why a prompt was routed where it was, and adjust the weights themselves.
- Stay local-first: scoring runs entirely on the user's machine with no external
  routing service and no prompt data leaving the device for classification.

## Non-Goals (for the POC)

- Machine-learned classification. Scoring is a transparent weighted heuristic, not
  a model. This is a deliberate design choice favoring inspectability over marginal
  accuracy.
- Acting as a transparent proxy in front of existing tools (this is Phase 2; see
  Architecture).
- **Automatic compaction.** Context-window size is a hard routing constraint
  (see Mapping), and Tack will *advise* when compacting the conversation would
  unlock cheaper routing or is required to proceed at all — but Tack never
  summarizes or drops context on its own. Compaction is lossy; the action stays
  with the user. Performing a compaction (even user-initiated) is a separate
  future change.

## Architecture

Tack is built in two phases. The POC is Phase 1.

**Phase 1 (POC) — Tack as client.** The user interacts with Tack directly through
its TUI. Tack receives the prompt, scores it, selects a model, calls that model's
API, and streams the response back. Because Tack owns the full context window
(system prompt, history, files, new message), it can measure exactly what will be
sent before dispatching.

**Phase 2 (future) — Tack as proxy.** A thin proxy layer reuses the same scoring
core, sitting transparently in front of existing tools (Claude Code, Cursor) via
API base-URL redirection. The scoring engine is unaware of delivery mechanism.

This phasing is why the scoring engine lives in its own crate with no knowledge of
how prompts arrive or where responses go.

## Workspace Layout

- `crates/tack-core` — scoring engine, model selection, tokenization, SQLite
  logging. Knows nothing about delivery (TUI vs proxy) or specific providers.
- `crates/tack-cli` — binary entry point, argument parsing (clap).
- `crates/tack-tui` — ratatui interface, consumes tack-core.

## How Routing Works (Conceptual)

Routing is a two-step process: score, then map.

**Scoring.** Each incoming prompt is assigned a numeric complexity score by summing
weighted signals. A signal is any cheaply-measurable property that correlates with
how hard the prompt is. Higher score means higher complexity. The signals are
extracted locally in microseconds — no model call is involved in the scoring
itself. The exact signals, weights, and thresholds live in the scoring capability
spec, because they are expected to evolve through tuning. Conceptually they include:

- Prompt size, measured in tokens via a local BPE tokenizer.
- Presence of complexity-indicating content (stack traces, large diffs).
- Presence of complexity-indicating keywords (e.g. "refactor", "architect")
  versus simplicity-indicating ones (e.g. "rename", "typo").

**Mapping.** The score is bucketed into one of three tiers — cheap, mid, frontier.
The user assigns concrete models to each tier in configuration; Tack itself is
model-agnostic and ships no hardcoded model list. A prompt scoring low routes to
the user's cheap-tier model; a high score routes to their frontier-tier model.

The mapped tier is *preferred*, not final. A feasibility step then guarantees the
chosen model's context window can actually hold the measured context (plus a
response-headroom reserve); if not, routing escalates to the smallest tier that
can. Context-driven escalations are tracked per session and, past a threshold,
surface a passive advisory that compaction would restore cheaper routing — and a
blocking advisory when no model can hold the context. Tack only ever advises;
auto-compaction is out of scope (see Non-Goals).

**Inspectability.** Every routing decision records which signals fired and their
contribution to the score, so the TUI can show, e.g., "routed to frontier:
large diff (+2), stack trace (+2), long prompt (+1)". This breakdown is a
first-class output of scoring, not an afterthought.

## Tokenization Note

Token counts are produced by a local BPE tokenizer (tiktoken-rs). This implements
OpenAI's tokenizers; counts for Anthropic models are therefore approximate. This is
acceptable because routing thresholds are coarse. Tokenization is abstracted behind
a trait so a provider-accurate tokenizer can be substituted later without changing
scoring logic.

## Persistence

Every routing decision is logged to a local SQLite database: the prompt's measured
signals, computed score, chosen tier and model, and (where available) outcome
signals such as whether the user retried. This history is the foundation for later
weight calibration and for the TUI's analytics view.

## Stack

- Language: Rust (edition 2024)
- Async runtime: tokio
- TUI: ratatui
- HTTP: reqwest
- Storage: SQLite via sqlx
- Tokenizer: tiktoken-rs (behind a trait)
- Errors: thiserror in libraries

## Conventions

- No `unwrap()` or `expect()` in library code; propagate errors with `thiserror`.
- The scoring engine must remain free of provider- and delivery-specific code.
- Every routing decision must be logged to SQLite.
- Scoring weights and thresholds must be configurable, never hardcoded constants
  buried in logic.
