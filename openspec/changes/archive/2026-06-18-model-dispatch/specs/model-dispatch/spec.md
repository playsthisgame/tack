## ADDED Requirements

### Requirement: Dispatch the routed model and stream its response

The system SHALL call the model selected for a prompt's routed tier and stream the
model's response incrementally to the caller as it is produced, rather than buffering
the entire completion before returning.

#### Scenario: A scored prompt is dispatched

- **WHEN** a user dispatches a prompt
- **THEN** the system scores it, selects the tier's configured model, calls that model,
  and emits the response text as a stream of chunks

#### Scenario: Output streams incrementally

- **WHEN** the model produces a response over time
- **THEN** the system surfaces text chunks as they arrive rather than waiting for the
  full completion

### Requirement: Resolve the provider from the tier's model string

The system SHALL interpret the tier's configured model as a `provider/model` string and
route the call to the matching provider, with no hardcoded provider or model baked into
dispatch logic. An unrecognized provider SHALL produce a clear error naming the offending
value.

#### Scenario: Known provider is selected

- **WHEN** the routed tier's model is `anthropic/claude-sonnet-4.6`
- **THEN** the system dispatches the call through the Anthropic provider using the
  `claude-sonnet-4.6` model identifier

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
