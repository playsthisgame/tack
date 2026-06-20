## Why

Tack scores and routes every prompt, but those decisions vanish the moment they
print. Without a durable record there is no data to calibrate the scoring weights
against, and no foundation for the TUI's planned analytics view. Persisting every
routing decision now — while the scoring engine is the only moving part — keeps the
storage layer simple and gives later changes (dispatch, TUI tuning) real history to
build on.

## What Changes

- Add a local SQLite store (`bun:sqlite`) that persists one row per routing
  decision: the prompt, its measured signals, computed score, chosen tier, chosen
  model, token count, and a timestamp.
- Define a `DecisionLog` interface in `core` and a `SqliteDecisionLog`
  implementation, keeping `core` free of any direct I/O coupling in its scoring path
  (the scorer stays pure; logging is a separate, injectable concern).
- Persist the full signal breakdown so a decision is reconstructable for later
  analysis and tuning — inspectability is preserved end-to-end, not just at print.
- Wire the CLI `score` command to write each decision to the database, with a flag
  to opt out (`--no-log`) and an env-overridable database path.
- Create the schema on first use (idempotent migration), defaulting the database to
  a conventional local path so the POC works with zero configuration.

## Capabilities

### New Capabilities
- `decision-logging`: Durable, local persistence of every routing decision and its
  full signal breakdown, exposed through a storage interface that `core` defines and
  the CLI consumes.

### Modified Capabilities
<!-- None: no existing specs in openspec/specs/. Scoring behavior is unchanged. -->

## Impact

- **New code**: a storage module in `packages/core/src` (interface + `bun:sqlite`
  implementation + schema/migration), exported from `core`'s public surface.
- **CLI**: `packages/cli/src/index.ts` gains logging wiring, a `--no-log` flag, and
  database-path resolution.
- **Dependencies**: none added — `bun:sqlite` ships with the Bun runtime.
- **Filesystem**: creates a SQLite database file on disk (default local path,
  overridable via env). Should be added to `.gitignore`.
- **No breaking changes**: scoring output and the `score` command's existing
  behavior are unchanged; logging is additive.
