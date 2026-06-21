# model-dispatch Specification

## Purpose

Dispatch a scored prompt to the model assigned to its tier, streaming the model's response incrementally to the caller. Provider resolution, API key handling, and SDK integration are isolated from core scoring logic behind a `Dispatcher` interface.

## Requirements

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

### Requirement: Resolve the provider from the tier's model string

The system SHALL interpret the tier's configured model as a `provider/model` string and
route the call to the matching provider, with no hardcoded provider or model baked into
dispatch logic. An unrecognized provider SHALL produce a clear error naming the offending
value.

#### Scenario: Known provider is selected

- **WHEN** the routed tier's model is `anthropic/claude-haiku-4-5`
- **THEN** the system dispatches the call through the Anthropic provider using the
  `claude-haiku-4-5` model identifier

#### Scenario: Unknown provider is rejected

- **WHEN** the routed tier's model names a provider the system does not support
- **THEN** the system reports an error identifying the unsupported provider and does not
  attempt a network call

### Requirement: Dispatcher interface decoupled from delivery and core

The system SHALL expose dispatch through a `Dispatcher` interface defined in `core` using
only pure types, with provider- and SDK-specific code living outside `core`. The scoring
engine SHALL remain free of provider and dispatch code.

#### Scenario: Core stays provider-free

- **WHEN** `core` is built
- **THEN** it contains the `Dispatcher` interface and dispatch types but imports no
  provider SDK or AI SDK package

#### Scenario: Implementation is swappable

- **WHEN** a caller depends on the `Dispatcher` interface
- **THEN** the AI SDK implementation can be replaced with another without changing the
  caller

### Requirement: Routing decision is shown before dispatch

The system SHALL make the routing decision inspectable at dispatch time by presenting the
chosen tier and model before the model's response is streamed, and SHALL persist the
decision using the existing decision log.

#### Scenario: Decision precedes the answer

- **WHEN** a prompt is dispatched
- **THEN** the chosen tier and model are shown to the user before any response text, and
  the decision is recorded to the log

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

### Requirement: Missing keys and provider failures are handled clearly

The system SHALL detect a missing required provider API key before dispatching and report
an actionable error, and SHALL surface provider/network failures without exposing API key
values.

#### Scenario: Required key is absent

- **WHEN** the provider for the routed model has no API key configured in the environment
- **THEN** the system reports which key is required and does not attempt the network call

#### Scenario: Provider call fails

- **WHEN** the provider returns an error or the network call fails
- **THEN** the system reports the failure to the user without printing any API key value
