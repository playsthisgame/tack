# tui-model-config Specification

## Purpose

Provide a TUI editor, opened by a non-conflicting keyboard shortcut, for viewing and changing
each tier's (`cheap`, `mid`, `frontier`) model. Edits are validated and persisted through the
tier-model configuration store and apply to subsequent prompts in the same session without a
restart, and the editor can be dismissed without changing anything.

## Requirements

### Requirement: Shortcut opens the tier-model editor

The TUI SHALL provide a keyboard shortcut that opens an editor showing each tier (`cheap`,
`mid`, `frontier`) and its current model. The shortcut SHALL NOT be a key that conflicts
with text entry or prompt submission, and pressing it SHALL NOT insert a character into the
prompt input.

#### Scenario: Shortcut opens the editor

- **WHEN** the user presses the tier-model editor shortcut
- **THEN** an editor appears listing `cheap`, `mid`, and `frontier` with their current models

#### Scenario: Shortcut does not type into the prompt

- **WHEN** the user presses the editor shortcut while the prompt input is focused
- **THEN** no character is inserted into the prompt input

### Requirement: Editing a tier's model validates and persists

Within the editor the user SHALL be able to change a tier's model. On confirm, the system
SHALL validate the entered model and, if valid, persist it via the tier-model configuration
store. An invalid entry SHALL surface an error within the editor and SHALL NOT be persisted.

#### Scenario: Valid model is saved

- **WHEN** the user sets `mid` to `anthropic/claude-sonnet-4-6` and confirms
- **THEN** the value is validated, persisted, and shown as the tier's current model

#### Scenario: Invalid model shows an error and is not saved

- **WHEN** the user sets a tier to `acme/whatever` and confirms
- **THEN** the editor shows an error and the tier's stored model is unchanged

### Requirement: Changes apply to subsequent prompts without restart

After a model change is saved, the system SHALL route and dispatch subsequent prompts in
the same session using the new model, without requiring a restart.

#### Scenario: Next prompt uses the new model

- **GIVEN** the user changed the `frontier` model and saved it
- **WHEN** the next prompt routes to `frontier`
- **THEN** it dispatches to the newly configured model

### Requirement: Editor can be dismissed without changes

The system SHALL allow dismissing the editor to return to the normal prompt without
modifying any tier's model.

#### Scenario: Dismiss returns to the prompt unchanged

- **WHEN** the user opens the editor and dismisses it without confirming an edit
- **THEN** the editor closes, the prompt input is focused again, and no model changed
