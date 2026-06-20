# decision-logging Specification

## Purpose

Persist routing decisions to a local store so they can be analyzed later and used for weight tuning, while keeping the scoring path pure and free of I/O.

## Requirements

### Requirement: Persist every routing decision

The system SHALL persist each routing decision to a local SQLite database as one
row, capturing the prompt text, the computed score, the chosen tier, the chosen
model, the measured token count, and a creation timestamp. Logging SHALL NOT alter
or delay the routing decision returned to the caller.

#### Scenario: A scored prompt is recorded

- **WHEN** a prompt is scored and routed to a tier and model
- **THEN** a row is written to the database containing the prompt, score, tier,
  model, token count, and a timestamp

#### Scenario: Logging does not change scoring output

- **WHEN** logging is enabled for a scored prompt
- **THEN** the routing decision returned to the caller is identical to the decision
  that would be returned with logging disabled

### Requirement: Persist the full signal breakdown

The system SHALL persist the complete list of signal contributions for each decision
so that the decision is fully reconstructable for later analysis and weight tuning.
Each stored contribution SHALL retain its signal identifier, human-readable detail,
and signed weight.

#### Scenario: Signal contributions are reconstructable

- **WHEN** a decision with one or more fired signals is logged and later read back
- **THEN** every contribution's signal identifier, detail, and weight match the
  original decision

#### Scenario: A decision with no fired signals is logged

- **WHEN** a baseline prompt is scored and no signals fire
- **THEN** the decision is still recorded with an empty contribution set and a score
  of zero

### Requirement: Storage interface decoupled from scoring

The system SHALL expose decision logging through a `DecisionLog` interface defined in
`core`, separate from the `Scorer`. The scoring path SHALL remain free of direct I/O;
persistence SHALL be an injectable concern that callers wire in.

#### Scenario: Scorer remains pure

- **WHEN** the scoring engine produces a routing decision
- **THEN** it performs no database access itself, and a separate `DecisionLog`
  implementation is responsible for persistence

#### Scenario: Storage implementation is swappable

- **WHEN** a caller depends on the `DecisionLog` interface
- **THEN** the `bun:sqlite` implementation can be substituted with another
  implementation without changing the caller

### Requirement: Idempotent schema initialization

The system SHALL create the required database schema on first use if it does not
already exist, and SHALL reuse an existing schema without error or data loss on
subsequent runs.

#### Scenario: First run creates the schema

- **WHEN** the database file or its tables do not yet exist
- **THEN** opening the log creates the schema and the database is ready to accept
  decisions

#### Scenario: Subsequent runs reuse existing data

- **WHEN** the database already contains the schema and prior decisions
- **THEN** opening the log succeeds without recreating tables or discarding existing
  rows

### Requirement: Configurable database location with opt-out

The system SHALL resolve the database path from configuration or environment with a
sensible default local path requiring zero setup, and SHALL allow a caller to disable
logging for a given invocation.

#### Scenario: Default path requires no configuration

- **WHEN** no database path is provided
- **THEN** the system uses a conventional default local path

#### Scenario: Environment override is honored

- **WHEN** an environment variable specifies a database path
- **THEN** the system writes to that path instead of the default

#### Scenario: Logging can be disabled per invocation

- **WHEN** the caller opts out of logging (e.g. via a `--no-log` flag)
- **THEN** the decision is produced and returned but no row is written to the
  database
