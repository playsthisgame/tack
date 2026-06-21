## ADDED Requirements

### Requirement: Input area is visually bordered

The system SHALL render a visible border around the prompt input area so the typing
target is clearly identifiable. The border SHALL be present whenever the normal text
input is active (i.e. not replaced by the API key prompt).

#### Scenario: Border visible in idle state

- **WHEN** the TUI is ready for input and no key prompt is active
- **THEN** the input area is enclosed in a visible border

#### Scenario: Border absent during key prompt

- **WHEN** the API key prompt is active in place of the normal input
- **THEN** the key entry area is not required to have the same border treatment
