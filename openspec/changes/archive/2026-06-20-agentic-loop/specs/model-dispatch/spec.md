## MODIFIED Requirements

### Requirement: Dispatch the routed model and stream its response

The system SHALL execute a user turn through the agentic loop, streaming a typed event
sequence — text deltas, tool activity, routing decisions, and a done signal — rather than
a raw text stream. The `Dispatcher` interface SHALL return `AsyncIterable<AgentEvent>`
in place of `{ textStream }`.

#### Scenario: A scored prompt is dispatched

- **WHEN** a user dispatches a prompt
- **THEN** the system enters the agentic loop, emitting events as the model calls tools
  and produces text, until a done event is emitted

#### Scenario: Output streams incrementally

- **WHEN** the model produces text during a step
- **THEN** `text-delta` events are emitted as text arrives rather than waiting for the
  full response

## ADDED Requirements

### Requirement: Each agentic step is routed independently

The system SHALL score the accumulated context at the start of each step in the agentic
loop and select the model whose tier best matches that context. Steps involving simple
tool orchestration MAY route to a cheaper tier than steps requiring complex synthesis.

#### Scenario: Routing may differ between steps

- **WHEN** the agentic loop begins a step whose accumulated context scores into a
  different tier than the previous step
- **THEN** the system selects the model for that tier and calls it for that step

#### Scenario: Routing event is emitted per step

- **WHEN** the system routes a step
- **THEN** a `routing` event is emitted carrying the step number, tier, model, and
  score before the model call begins
