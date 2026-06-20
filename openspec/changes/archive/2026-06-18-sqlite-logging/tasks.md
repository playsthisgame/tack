## 1. Storage interface in core

- [x] 1.1 Add a `DecisionLog` interface to `packages/core/src/types.ts` with
  `record(context: PromptContext, decision: RoutingDecision): void` and `close(): void`
- [x] 1.2 Document the interface as the persistence swap point, mirroring the existing
  `Scorer`/`Tokenizer` interface comments

## 2. SQLite implementation

- [x] 2.1 Create `packages/core/src/decision-log.ts` with a `SqliteDecisionLog` class
  implementing `DecisionLog`, opening a `bun:sqlite` `Database` from a constructor path arg
- [x] 2.2 Implement idempotent schema init with `CREATE TABLE IF NOT EXISTS` for
  `decisions` and `contributions` (with the columns and foreign key from design.md)
- [x] 2.3 Implement `record()` to insert the decision and its contributions inside a
  single transaction, storing `created_at` as ISO-8601 UTC text
- [x] 2.4 Implement `close()` to close the database handle
- [x] 2.5 Export `DecisionLog` and `SqliteDecisionLog` from `packages/core/src/index.ts`

## 3. CLI wiring

- [x] 3.1 Add database-path resolution in `packages/cli/src/index.ts`: explicit arg →
  `TACK_DB_PATH` env → default `./.tack/tack.db` (create the directory if absent)
- [x] 3.2 Parse a `--no-log` flag in the `score` command and skip log construction when set
- [x] 3.3 After printing the decision, call `log.record(context, decision)` then
  `log.close()`, treating write failures as best-effort (report, do not block output)
- [x] 3.4 Update CLI usage text to document `--no-log` and the `TACK_DB_PATH` env var

## 4. Tests

- [x] 4.1 Add tests using an in-memory or temp-file database that a scored decision is
  persisted with correct score, tier, model, and token count
- [x] 4.2 Test that all signal contributions round-trip (identifier, detail, weight)
- [x] 4.3 Test a baseline (no signals fired) decision is recorded with an empty
  contribution set and score zero
- [x] 4.4 Test idempotent init: opening an existing database preserves prior rows
- [x] 4.5 Test that the routing decision returned/printed is identical with and without
  logging enabled

## 5. Project housekeeping

- [x] 5.1 Add the default database path (`.tack/`) to `.gitignore`
- [x] 5.2 Update `README.md` roadmap/usage to note SQLite logging is implemented and
  document `--no-log` and `TACK_DB_PATH`
- [x] 5.3 Run `bun test` and `bun run typecheck` and confirm both pass
