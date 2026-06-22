# tier-model-config Specification

## Purpose

Allow users to override the built-in default model for each routing tier, persisting each
tier's model, context-window size, and input cost together in a dedicated configuration
store. Routing and dispatch read this configuration so a user's chosen model, window, and
cost stay coherent, while the store remains separate from secrets and source code.

## Requirements

### Requirement: User tier-model configuration overrides defaults

The system SHALL load a user tier-model configuration from a local store and merge it over
the built-in defaults, so routing and dispatch use the user's chosen model for each tier.
When no user configuration exists, the built-in defaults SHALL be used unchanged, and
loading SHALL NOT fail.

#### Scenario: No stored configuration uses defaults

- **GIVEN** no user tier-model configuration exists
- **WHEN** the configuration is loaded
- **THEN** the built-in default model for each tier is used
- **AND** no error is raised

#### Scenario: Stored override replaces a tier's model

- **GIVEN** a stored configuration sets the `frontier` tier model to `openai/gpt-x`
- **WHEN** the configuration is loaded and a prompt routes to `frontier`
- **THEN** dispatch uses `openai/gpt-x` for that prompt

### Requirement: Per-tier model, window, and cost stay coherent

The configuration SHALL associate each tier with its model identifier, its context-window
size, and its input cost, and SHALL persist and load these together. Context-aware routing
SHALL use the configured window, and the cost advisory SHALL use the configured cost, so
both remain consistent with the configured model.

#### Scenario: Routing uses the configured window

- **GIVEN** a tier's model is configured with a 200,000-token window
- **WHEN** a context larger than 200,000 tokens routes through that tier
- **THEN** the feasibility check uses the configured window, not the default window

#### Scenario: Advisory uses the configured cost

- **GIVEN** a tier's model is configured with a specific input cost
- **WHEN** a cost-driven escalation advisory is produced
- **THEN** the estimate uses the configured per-tier cost

### Requirement: Model strings validated against known providers

Before a tier-model configuration is saved, the system SHALL validate each model identifier
as a `provider/model` string whose provider is in the known provider set. An invalid or
unknown-provider model SHALL be rejected with a clear message and SHALL NOT be persisted.

#### Scenario: Known provider accepted

- **WHEN** a tier model is set to `anthropic/claude-haiku-4-5`
- **THEN** validation passes and the configuration is saved

#### Scenario: Unknown provider rejected

- **WHEN** a tier model is set to `acme/whatever`
- **THEN** validation fails with a message naming the unknown provider
- **AND** the prior configuration is left unchanged

### Requirement: Configuration store is separate from secrets and code

The system SHALL persist the tier-model configuration in a store distinct from the secrets
store and from source code, and SHALL NOT write API keys into it.

#### Scenario: Configuration saved to its own store

- **WHEN** a tier-model change is saved
- **THEN** it is written to the tier-model configuration store, not to the secrets store
  and not to source

#### Scenario: Secrets never written to model config

- **WHEN** an API key is entered elsewhere and saved
- **THEN** the tier-model configuration store does not contain the key
