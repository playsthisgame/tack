## ADDED Requirements

### Requirement: Provider keys resolved from layered sources

The system SHALL resolve a provider's API key by checking sources in a defined order:
the environment (including `.env`) first, then a local secrets store. The resolved key
SHALL be supplied to the dispatcher through its existing environment seam, leaving
dispatch logic unchanged.

#### Scenario: Key present in environment

- **WHEN** a provider's API key is set in the environment
- **THEN** dispatch uses it without prompting the user

#### Scenario: Key present only in the secrets store

- **WHEN** a provider's key is absent from the environment but present in the local
  secrets store
- **THEN** the system resolves it from the store and dispatch proceeds

### Requirement: Secrets are kept separate from scoring config

The system SHALL store API keys in a secrets store distinct from the scoring
configuration, and SHALL NOT write API keys into the scoring config.

#### Scenario: Scoring config never holds keys

- **WHEN** a key is entered and saved
- **THEN** it is written to the secrets store and the scoring configuration is not
  modified

### Requirement: Prompt for a missing key in-app

The system SHALL detect when the model selected for a prompt has no resolvable API key
and SHALL prompt the user to enter it within the interface rather than failing, offering
to save it for future use. Only keys for providers actually referenced by the configured
tiers SHALL be requested.

#### Scenario: Missing key prompts inline

- **WHEN** the user dispatches a prompt whose selected model's provider key cannot be
  resolved
- **THEN** the interface prompts for that key and, once provided, proceeds to dispatch

#### Scenario: Saving a key persists it for next time

- **WHEN** the user enters a key and chooses to save it
- **THEN** the key is written to the secrets store so a later dispatch resolves it without
  prompting again

### Requirement: Keys are never exposed

The system SHALL NOT display or log API key values, including in error messages.

#### Scenario: Errors omit the key

- **WHEN** a dispatch error referencing credentials is shown
- **THEN** the message does not contain the API key value
