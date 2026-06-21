## ADDED Requirements

### Requirement: Loading indicator shown while dispatch is in flight

The system SHALL display a visual loading indicator on a turn while its dispatch is in
flight and no response text has yet been received. The indicator SHALL be removed as
soon as the first response chunk arrives or the turn completes (with response or error).

#### Scenario: Spinner shown before first chunk

- **WHEN** a turn has been dispatched and no response text has arrived yet
- **THEN** a loading indicator is visible within that turn

#### Scenario: Spinner replaced by response text

- **WHEN** the first response chunk arrives for an in-flight turn
- **THEN** the loading indicator is no longer shown and the response text is displayed instead

#### Scenario: Spinner absent on completed turns

- **WHEN** a turn is done (response complete or error set)
- **THEN** no loading indicator is shown for that turn
