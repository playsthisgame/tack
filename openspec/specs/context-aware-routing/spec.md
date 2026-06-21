# context-aware-routing Specification

## Purpose

This capability makes the model router treat context-window size as a first-class
routing constraint alongside complexity. The router escalates to a tier whose model
can actually hold the measured full context (plus a response-headroom reserve),
surfaces a blocking advisory when no configured model can hold the context, and
tracks cost-driven escalations per session. When escalations cross a configured
threshold, Tack surfaces a passive, dismissible compaction advisory. Tack never
compacts the conversation automatically.

## Requirements

### Requirement: Context window as a hard routing constraint

The router SHALL NOT select a tier whose model context window is smaller than the
measured full-context token count plus a configured response-headroom reserve.
When the complexity-preferred tier is infeasible, the router SHALL escalate to the
lowest tier whose model can hold the context.

#### Scenario: Simple prompt on a large context escalates

- **GIVEN** a prompt that scores in the cheap tier by complexity
- **AND** the full context measures 150,000 tokens
- **AND** the cheap-tier model has a 128,000-token window
- **AND** the mid-tier model has a 200,000-token window
- **WHEN** the prompt is routed
- **THEN** the chosen tier is mid, not cheap
- **AND** the decision records an escalation contribution naming the window overflow

#### Scenario: Simple prompt on a small context stays cheap

- **GIVEN** a prompt that scores in the cheap tier by complexity
- **AND** the full context fits within the cheap-tier model's window with headroom
- **WHEN** the prompt is routed
- **THEN** the chosen tier is cheap
- **AND** no escalation contribution is recorded

#### Scenario: No feasible tier

- **GIVEN** a full context larger than every configured tier model's window
- **WHEN** the prompt is routed
- **THEN** the router selects the largest-window tier
- **AND** the decision flags that the context exceeds all windows

### Requirement: Blocking advisory when no model can hold the context

When the full context exceeds every tier model's window (minus headroom), Tack
SHALL surface a blocking advisory stating that compaction is required before the
request can proceed. This is distinct from the cost-saving advisory. Tack SHALL
NOT perform the compaction itself.

#### Scenario: Context exceeds all windows

- **GIVEN** a full context of 250,000 tokens
- **AND** the largest tier model has a 200,000-token window
- **WHEN** the prompt is routed
- **THEN** a blocking advisory is surfaced stating compaction is required
- **AND** no request is dispatched
- **AND** no compaction is performed by Tack

### Requirement: Configurable context windows and headroom

Each tier model SHALL have a configured context-window size, and the config SHALL
define a response-headroom reserve subtracted from each window when testing
feasibility. These values SHALL live in configuration, not in routing logic.

#### Scenario: Headroom reserve is respected

- **GIVEN** a model window of 128,000 and a headroom reserve of 8,000
- **AND** a full context of 124,000 tokens
- **WHEN** feasibility is tested
- **THEN** the context is treated as NOT fitting (124,000 > 128,000 − 8,000)

### Requirement: Session tracking of cost-driven escalations

Tack SHALL track, per session, the number of prompts whose preferred tier was
overridden solely due to context size, and an estimate of the additional cost
incurred by those escalations.

#### Scenario: Escalations accumulate

- **GIVEN** a session in which five cheap-preferred prompts escalated to mid due to
  context size
- **WHEN** the session counters are read
- **THEN** the cost-driven escalation count is five
- **AND** an estimated extra cost is reported

### Requirement: Passive compaction advisory

When cost-driven escalations cross a configured threshold, Tack SHALL surface a
dismissible advisory indicating that compacting the conversation could restore
cheaper routing, including an estimated saving. Tack SHALL NOT compact
automatically and SHALL NOT take any action on the conversation without explicit
user initiation.

#### Scenario: Advisory appears after threshold

- **GIVEN** a configured advisory threshold of three cost-driven escalations
- **WHEN** the count reaches three
- **THEN** an advisory is surfaced once, naming the estimated saving
- **AND** no compaction is performed

#### Scenario: Advisory never auto-acts

- **GIVEN** the advisory has been surfaced
- **WHEN** the user does not act on it
- **THEN** the conversation context is left unchanged
- **AND** routing continues to escalate as needed for correctness
