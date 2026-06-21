## Why

Tack currently dispatches a single prompt to a model and streams the response — making it a smarter chat window rather than a coding agent. To be genuinely useful for coding tasks (and to make tier routing matter at scale), Tack needs an agentic loop: a model that can read files, run commands, and iterate until a task is done, with each model call scored and routed independently.

## What Changes

- **BREAKING** Replace the single `streamText` dispatch with a multi-turn agentic loop using `generateText` with tool support; callers receive a stream of events (text chunks, tool calls, tool results) rather than a raw text stream
- Add a core tool set: `read_file`, `write_file`, `bash` — executed locally with the same trust model as Claude Code (no sandbox by default)
- Inject a system prompt on every session containing the working directory, a shallow file tree, and current git context so the model knows where it is without being told
- Score and route each model call in the loop independently — a file-read call may go to Haiku while the final synthesis goes to Opus
- Expose loop events to the TUI so users see tool calls and results inline in the transcript

## Capabilities

### New Capabilities

- `agent-loop`: The core agentic execution engine — runs the model-call → tool-execute → feed-result loop until the model produces a final response or a turn limit is reached
- `tool-registry`: Definition, registration, and execution of the built-in tools (`read_file`, `write_file`, `bash`); extensible for future tools
- `context-injection`: Automatic system prompt assembly from environment (cwd, file tree, git branch/status) injected into every agent session

### Modified Capabilities

- `model-dispatch`: Dispatch changes from a single `streamText` call to a participant in the agentic loop; the `Dispatcher` interface gains tool-aware variants and per-call scoring hooks
- `tui-shell`: Transcript must render tool call and tool result events inline, not just text chunks

## Impact

- `packages/dispatch/`: major rewrite of dispatcher; new `AgentLoop` class and tool execution layer
- `packages/core/`: `PromptContext` gains `system` field usage; new `AgentEvent` union type for streaming events
- `packages/tui/src/useTack.ts`: `Turn` gains tool call/result arrays; `streamInto` replaced by agent event consumer
- `packages/tui/src/app.tsx`: new `ToolCallView` and `ToolResultView` components
- New dependency: none — `generateText` with tools is already in the `ai` package
- Bash tool requires Node `child_process` (already available in Bun)
