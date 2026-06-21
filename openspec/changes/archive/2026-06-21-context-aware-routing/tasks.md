# Tasks: Context-Aware Routing & Compaction Advisor

## Config
- [x] Add `contextWindow` (tokens) to each tier model in `ScoringConfig.tierModels`
      (or a parallel map keyed by tier).
- [x] Add `responseHeadroom` (tokens) to `ScoringConfig`.
- [x] Add `advisoryThreshold` (count of cost-driven escalations) to config.
- [x] Set sensible defaults; document that these are tunable.

## Types
- [x] Extend `RoutingDecision` to expose whether an escalation occurred and the
      preferred-vs-final tier (within existing `contributions`, plus an explicit
      `escalated: boolean` if cleaner).
- [x] Add a session-stats type capturing cost-driven escalation count and
      estimated extra cost.

## Scorer / routing
- [x] Split routing into two stages: (1) complexity → preferred tier (existing),
      (2) feasibility check → final tier.
- [x] Implement feasibility: smallest tier whose `contextWindow − responseHeadroom`
      is ≥ measured `tokenCount`.
- [x] On escalation, append an inspectable contribution describing the overflow.
- [x] Handle the no-feasible-tier case (pick largest window, flag it).

## Session tracking
- [x] Maintain per-session counters for cost-driven escalations and estimated
      extra cost (requires a per-tier cost figure in config or a cost estimator).
- [x] Increment only when escalation cause is context size, not complexity.

## Advisory
- [x] When counters cross `advisoryThreshold`, emit a single advisory event with
      estimated saving.
- [x] Surface it in the CLI/TUI as dismissible; ensure it is informational only.
- [x] When context exceeds all tier windows, emit a distinct **blocking** advisory
      stating compaction is required; do not dispatch the request.
- [x] Guarantee no code path performs compaction or mutates conversation context.

## Tests
- [x] Cheap-preferred + oversized context → escalates to mid.
- [x] Cheap-preferred + small context → stays cheap, no escalation contribution.
- [x] Headroom reserve correctly excludes near-window-limit contexts.
- [x] Context larger than all windows → largest tier chosen and flagged.
- [x] Escalation counters increment only for context-driven escalations.
- [x] Advisory fires exactly once at threshold and performs no action.
- [x] Context exceeding all windows triggers a blocking advisory and no dispatch.

## Docs
- [x] README: note context-window awareness and the advisory (advisory-only,
      client mode).
- [x] project.md: record that auto-compaction is deliberately out of scope.
