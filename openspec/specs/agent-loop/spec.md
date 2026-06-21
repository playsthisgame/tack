# agent-loop Specification

## Purpose

Drive each user turn as a multi-step agentic loop that scores and routes each step independently, executes tool calls requested by the model, and exposes progress as a typed event stream so callers can observe text deltas, tool activity, routing decisions, and completion.

## Requirements

### Requirement: Multi-step agentic loop drives each user turn

The system SHALL execute each user turn as a multi-step agentic loop: score the context,
call the selected model, execute any tool calls the model requests, feed results back,
and repeat until the model produces a final text response or a step limit is reached.
Each step in the loop SHALL be scored and routed independently.

#### Scenario: Single-step turn with no tools

- **WHEN** the model produces a final text response on its first step with no tool calls
- **THEN** the loop completes after one step and the response is surfaced to the caller

#### Scenario: Multi-step turn with tool calls

- **WHEN** the model requests one or more tool calls in a step
- **THEN** the system executes the tools, feeds the results back as the next step's
  input, and continues the loop until the model produces a final text response

#### Scenario: Per-step routing selects the model for each step

- **WHEN** the loop begins a new step
- **THEN** the system scores the accumulated context for that step and selects the model
  whose tier best matches, which may differ from the model used in prior steps

#### Scenario: Step limit terminates runaway loops

- **WHEN** the number of steps in a loop reaches the configured maximum
- **THEN** the loop terminates and surfaces the model's last partial response or an
  error to the caller

### Requirement: Agent loop emits a typed event stream

The system SHALL expose the agentic loop's progress as a stream of typed events so
callers can observe text deltas, tool activity, routing decisions, and completion without
coupling to the AI SDK's internal types.

#### Scenario: Text delta events carry incremental output

- **WHEN** the model produces text during a step
- **THEN** one or more `text-delta` events are emitted carrying the incremental text

#### Scenario: Tool call and result events are emitted

- **WHEN** the model requests a tool call and the system executes it
- **THEN** a `tool-call` event is emitted before execution and a `tool-result` event
  is emitted after, both carrying the tool name and a correlation ID

#### Scenario: Routing event is emitted at each step

- **WHEN** the loop scores and routes a step
- **THEN** a `routing` event is emitted carrying the step number, selected tier, model,
  and score

#### Scenario: Done event signals completion

- **WHEN** the loop produces a final response or terminates due to the step limit
- **THEN** a `done` event is emitted as the last event in the stream
