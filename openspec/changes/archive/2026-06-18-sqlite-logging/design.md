## Context

Tack's scoring engine (`@tack/core`) is pure and I/O-free by design: `HeuristicScorer`
turns a `PromptContext` into a `RoutingDecision` with a full `SignalContribution[]`
breakdown, and the CLI `score` command prints it. Nothing is persisted, so there is no
history to tune weights against or to feed the planned TUI analytics view.

This change adds local persistence. The constraints that shape it:

- `core` must stay free of provider- and delivery-specific code, and the scoring path
  must stay pure — logging is a separate concern.
- The runtime is Bun; `bun:sqlite` is built in, so no dependency is added. (The stale
  `openspec/project.md` references Rust/sqlx; the actual stack is Bun + TypeScript, per
  README and `package.json`, and this design follows the real stack.)
- Inspectability is a first-class product requirement: the signal breakdown must
  survive into storage, not just the print path.

## Goals / Non-Goals

**Goals:**
- Persist one row per routing decision plus its full signal breakdown.
- Define a `DecisionLog` interface in `core`, implemented by `SqliteDecisionLog`.
- Keep `Scorer` untouched and pure; wire logging in at the CLI seam.
- Zero-config default path, env override, and a `--no-log` opt-out.
- Idempotent, self-creating schema.

**Non-Goals:**
- Querying, reporting, or analytics UI (later TUI change consumes this data).
- Outcome signals such as retries or user feedback (no dispatch yet to observe them);
  the schema should not block adding them later, but they are out of scope now.
- Concurrency/multi-writer hardening beyond SQLite's defaults.
- A config-file loader; path resolution is constructor arg + env + default only.

## Decisions

### Decision: `DecisionLog` interface in `core`, implementation alongside it

Define `interface DecisionLog { record(context: PromptContext, decision: RoutingDecision): void; close(): void; }`
in `core/src/types.ts`, and implement `SqliteDecisionLog` in a new
`core/src/decision-log.ts`, exported from `core`'s index.

- **Why**: Mirrors the existing `Scorer`/`Tokenizer` pattern — `core` owns the
  interface as the swap point, callers depend on the abstraction. It keeps the scorer
  pure: the CLI calls `scorer.score(...)` then `log.record(...)` as two steps.
- **Alternative considered**: have the scorer write its own decisions. Rejected — it
  couples scoring to I/O and breaks the "scorer knows nothing about delivery" rule.
- **Alternative considered**: put storage in a separate `@tack/storage` package.
  Rejected as premature for the POC; co-locating in `core` keeps the dependency graph
  flat, and the interface boundary already makes extraction trivial later.

### Decision: `bun:sqlite` with a two-table schema

Use Bun's built-in `Database` from `bun:sqlite`. Schema:

- `decisions(id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, prompt TEXT NOT NULL,
  score REAL NOT NULL, tier TEXT NOT NULL, model TEXT NOT NULL, token_count INTEGER NOT NULL)`
- `contributions(id INTEGER PRIMARY KEY, decision_id INTEGER NOT NULL REFERENCES
  decisions(id), signal TEXT NOT NULL, detail TEXT NOT NULL, weight REAL NOT NULL)`

`created_at` stored as ISO-8601 UTC text. Writes for a single decision wrapped in a
transaction so a decision and its contributions are atomic.

- **Why normalize contributions**: one row per fired signal makes later tuning queries
  (e.g. "how often does `stack_trace` fire and where does it route?") natural SQL.
- **Alternative considered**: store `contributions` as a JSON blob column on
  `decisions`. Simpler to write, but defeats queryability — the whole point of logging
  is calibration analysis. Rejected.

### Decision: Path resolution — arg → env → default

`SqliteDecisionLog` takes an optional path. The CLI resolves: explicit arg, else
`TACK_DB_PATH` env var, else a default local path (`./.tack/tack.db`, created if
absent). The default keeps the POC zero-config; the env var supports tests pointing at
a temp file or `:memory:`.

- **Why**: matches the project's "configurable, never hardcoded" convention without
  pulling in a config-file loader yet.

### Decision: `--no-log` opt-out at the CLI

The `score` command logs by default; `--no-log` skips constructing the log. Scoring
output is identical either way.

- **Why**: logging-by-default is what generates calibration data; the opt-out covers
  scripted/repeated invocations and respects the spec's per-invocation control.

## Risks / Trade-offs

- **Prompt text is stored in plaintext on disk** → Acceptable for a local-first POC
  where the data never leaves the device; document the DB path and gitignore it.
  Revisit (hashing/redaction) if prompts ever sync.
- **`bun:sqlite` couples `core` to the Bun runtime** → `core` was already Bun-targeted
  (tests run under `bun test`); the `DecisionLog` interface isolates the coupling to
  one file, so a non-Bun implementation can be dropped in later.
- **Logging failures could disrupt scoring** → Treat `record` as best-effort at the
  CLI seam: a write error is reported but does not swallow or block the printed
  decision. Keeps routing resilient to a bad DB path.
- **Schema will need to grow** (outcome signals later) → Use additive migrations;
  the idempotent init checks `CREATE TABLE IF NOT EXISTS`, and future columns can be
  added without rewriting existing rows.

## Migration Plan

Additive only — no existing data or behavior to migrate. On first run the schema is
created automatically. Rollback is dropping the change: deleting the DB file and
reverting code restores prior behavior, since scoring is unaffected.

## Open Questions

- Final default path: `./.tack/tack.db` (project-local) vs. an XDG-style user data dir.
  Proposing project-local for POC simplicity; revisit if multiple projects should share
  one history.
