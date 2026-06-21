## MODIFIED Requirements

### Requirement: Model response is streamed into the turn

The system SHALL consume the agent event stream for a turn and render each event type
inline in the transcript: text deltas accumulate as the response, tool calls and results
appear as collapsible inline entries, and routing events update the per-step model badge.

#### Scenario: Response appears incrementally

- **WHEN** the model produces text during a step
- **THEN** the turn's response text grows as `text-delta` events arrive

#### Scenario: Tool call is shown inline

- **WHEN** a `tool-call` event is received for the active turn
- **THEN** the transcript shows the tool name and a summary of its arguments inline
  within that turn

#### Scenario: Tool result is shown inline

- **WHEN** a `tool-result` event is received for the active turn
- **THEN** the transcript shows a summary of the result beneath the corresponding
  tool call entry

## ADDED Requirements

### Requirement: Per-step routing badge shown in transcript

The system SHALL display a routing badge for each step in the agentic loop that
involves a model call, so the user can see which model handled each step of a multi-step
turn.

#### Scenario: Single-step turn shows one badge

- **WHEN** a turn completes in a single step
- **THEN** one routing badge is shown, identical in appearance to the existing
  tier · model badge

#### Scenario: Multi-step turn shows a badge per step

- **WHEN** a turn completes across multiple steps
- **THEN** a routing badge is shown for each step that involved a model call, in order
