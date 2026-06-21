# tui-welcome Specification

## Purpose

Provide an initial welcome panel in the TUI so the interface looks intentional and guides the user when no turns have been submitted yet.

## Requirements

### Requirement: Welcome panel shown at startup

The system SHALL display a welcome panel when the TUI first opens and no turns are present, giving the user orientation before their first prompt.

#### Scenario: Welcome panel is visible on launch

- **WHEN** the TUI starts and the transcript contains no turns
- **THEN** a welcome panel is shown in the transcript area

#### Scenario: Welcome panel is replaced by the first turn

- **WHEN** the user submits their first prompt
- **THEN** the welcome panel is no longer shown and the turn appears in its place
