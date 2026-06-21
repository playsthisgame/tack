## ADDED Requirements

### Requirement: Welcome panel shown at startup

The system SHALL display a welcome panel when the TUI starts and no turns have been
submitted yet. The panel SHALL list each tier and its configured model, and SHALL list
the active keybindings. The panel SHALL disappear automatically once the user submits
their first prompt.

#### Scenario: Panel visible before first prompt

- **WHEN** the TUI has just launched and no prompts have been submitted
- **THEN** a welcome panel is visible showing the tier-to-model mapping and keybindings

#### Scenario: Panel lists all three tiers

- **WHEN** the welcome panel is displayed
- **THEN** it shows each of the cheap, mid, and frontier tiers alongside their configured model strings

#### Scenario: Panel disappears after first submit

- **WHEN** the user submits their first prompt
- **THEN** the welcome panel is no longer rendered and the transcript takes its place
