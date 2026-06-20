# tui-shell Specification

## Purpose

Provide an interactive terminal interface that presents a persistent prompt input, a scrolling transcript of turns, and per-turn routing visibility, launched when `tack` is invoked with no subcommand.

## Requirements

### Requirement: Bare `tack` launches the TUI

The system SHALL launch the interactive TUI when `tack` is invoked with no subcommand. The
`score` and `dispatch` subcommands SHALL continue to work, and `tack --help` SHALL print
usage rather than launching the TUI.

#### Scenario: No subcommand starts the TUI

- **WHEN** the user runs `tack` with no subcommand
- **THEN** the interactive TUI starts

#### Scenario: Subcommands and help are unaffected

- **WHEN** the user runs `tack score "..."`, `tack dispatch "..."`, or `tack --help`
- **THEN** the respective subcommand runs (or usage prints) and the TUI does not launch

### Requirement: Interactive prompt loop

The system SHALL present an interactive terminal interface with a persistent prompt input
and a scrolling transcript of turns. Submitting a prompt SHALL append a turn to the
transcript and leave the input ready for the next prompt without exiting.

#### Scenario: Submitting a prompt adds a turn

- **WHEN** the user types a prompt and submits it
- **THEN** a new turn containing that prompt appears in the transcript and the input is
  cleared and ready for the next prompt

#### Scenario: Session persists across turns

- **WHEN** the user submits a second prompt after a first
- **THEN** both turns remain visible in the transcript in order

### Requirement: Selected model is shown for each prompt

The system SHALL display the routed tier and the selected model for a submitted prompt,
and SHALL show this before the model's response is streamed. The selected model SHALL be
derived from the prompt's routing decision, not hardcoded.

#### Scenario: Model is revealed before the response

- **WHEN** a prompt is scored and routed
- **THEN** the turn shows the chosen tier and model (e.g. the tier's `provider/model`)
  before any response text appears

#### Scenario: A later turn can show a different model

- **WHEN** a subsequent prompt scores into a different tier than an earlier one
- **THEN** that turn displays its own tier and model, which may differ from the earlier
  turn's

### Requirement: Routing rationale is available on demand

The system SHALL make the signal breakdown for a turn's routing decision viewable on
demand, so the user can see why a prompt routed where it did without the breakdown
cluttering every turn by default.

#### Scenario: Breakdown is revealed when requested

- **WHEN** the user toggles the rationale for a turn
- **THEN** the signal contributions (identifier/detail and signed weight) for that turn's
  decision are displayed

### Requirement: Model response is streamed into the turn

The system SHALL stream the selected model's response into the corresponding turn as
chunks arrive, rather than displaying the response only after it is complete.

#### Scenario: Response appears incrementally

- **WHEN** the model produces its response over time
- **THEN** the turn's response text grows as chunks arrive

### Requirement: Decisions are logged like the CLI

The system SHALL persist each routing decision using the existing decision log, with the
same best-effort behavior as the CLI (a logging failure SHALL NOT block the interface or
the response).

#### Scenario: A turn's decision is recorded

- **WHEN** a prompt is scored in the TUI
- **THEN** its decision is recorded to the decision log

#### Scenario: Logging failure does not break the loop

- **WHEN** logging a decision fails
- **THEN** the interface continues and the response still streams
