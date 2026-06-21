## MODIFIED Requirements

### Requirement: Interactive prompt loop

The system SHALL present an interactive terminal interface with a visually bordered
prompt input and a scrolling transcript of turns. Submitting a prompt SHALL append a
turn to the transcript and leave the input ready for the next prompt without exiting.

#### Scenario: Submitting a prompt adds a turn

- **WHEN** the user types a prompt and submits it
- **THEN** a new turn containing that prompt appears in the transcript and the input is
  cleared and ready for the next prompt

#### Scenario: Session persists across turns

- **WHEN** the user submits a second prompt after a first
- **THEN** both turns remain visible in the transcript in order

#### Scenario: Input area has a visible border

- **WHEN** the TUI is ready for input
- **THEN** the prompt input is enclosed in a visible border that distinguishes it from
  the transcript
