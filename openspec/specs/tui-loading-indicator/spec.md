# tui-loading-indicator Specification

## Purpose

Provide visual feedback in the TUI while a dispatched prompt is awaiting a response, so the user knows the system is working.

## Requirements

### Requirement: Loading indicator shown while dispatch is in flight

The system SHALL display a loading indicator in the active turn from the moment a prompt is dispatched until the first response chunk arrives (or an error is shown), so the user has immediate feedback that work is in progress.

#### Scenario: Indicator appears on submit

- **WHEN** the user submits a prompt
- **THEN** a loading indicator is visible in the turn before any response text appears

#### Scenario: Indicator disappears when response begins

- **WHEN** the first chunk of the model response arrives
- **THEN** the loading indicator is replaced by the streaming response text
