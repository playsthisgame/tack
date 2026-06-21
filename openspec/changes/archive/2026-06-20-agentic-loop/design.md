## Context

Tack currently dispatches a single `streamText` call per user turn and streams the raw text back. This means the model has no tools, no knowledge of the environment, and no ability to iterate. The `Dispatcher` interface returns `{ textStream: AsyncIterable<string> }` and `useTack.ts` consumes it in a single `for await` loop.

The goal is to replace this with a full agentic loop: the model calls tools, Tack executes them, results are fed back, and the model continues until it produces a final response. Per-call routing — Tack's core differentiator — fires on every step of the loop, not just once per user turn.

## Goals / Non-Goals

**Goals:**
- Multi-step agentic loop driven by `streamText` with tools and `maxSteps`
- Built-in tools: `read_file`, `write_file`, `bash`
- System prompt injection (cwd, file tree, git context) at session start
- Per-step routing: each model call in the loop is scored and may land on a different tier
- `AgentEvent` stream replacing the raw text stream so the TUI can render tool calls inline

**Non-Goals:**
- Sandboxing or containerisation of tool execution — same local trust model as Claude Code
- Custom tool registration by end users (future work)
- Parallel tool execution (serial is sufficient for the POC)
- Streaming partial tool results (tool results are fed back complete)

## Decisions

### 1. `streamText` with tools + `maxSteps`, not `generateText`

The AI SDK's `streamText` supports `tools` and `maxSteps` in v4+. It drives the full agentic loop — model calls tool, SDK executes it via the `execute` function, result is fed back, next step begins — while still yielding text deltas incrementally through `fullStream`. Using `streamText` keeps the existing streaming UX (text appears as it's typed) while gaining tool use.

`generateText` buffers the full response before returning, which would break incremental display. Rejected.

### 2. `fullStream` as the event source

`result.fullStream` emits a typed union of `text-delta`, `tool-call`, `tool-result`, `step-start`, `step-finish`, `finish`, and `error` events. The `AgentLoop` translates these into Tack's own `AgentEvent` union (defined in `core`) before forwarding to callers. This keeps the TUI decoupled from the AI SDK's types.

### 3. Per-step routing via a scoring hook on `AgentLoop`

Each `step-start` event from `fullStream` represents a new model call. Before each step, `AgentLoop` scores the accumulated context (original prompt + history + tool results so far) and selects the model for that step. This requires abandoning the single-model `streamText` call in favour of a step callback that re-invokes `streamText` with the newly selected model.

Concretely: `AgentLoop` manages its own step loop rather than relying on `maxSteps` inside a single `streamText` call, because `maxSteps` doesn't allow changing the model between steps. Each iteration: score → select model → `streamText` one step (tools: `maxSteps: 1`) → collect tool calls → execute tools → push results into next step's messages.

**Alternative considered:** use `maxSteps` and a fixed model per turn. Simpler, but loses per-call routing entirely. Rejected — routing is the differentiator.

### 4. Tool registry as a plain record of Zod-schema tool definitions

Tools are defined as `Record<string, ToolDefinition>` where each entry carries:
- `description`: shown to the model
- `parameters`: a Zod schema (required by the AI SDK's tool interface)
- `execute`: `(args) => Promise<string>` — returns a string result fed back to the model

The AI SDK's `tool()` helper wraps these into the shape `streamText` expects. The registry is passed into `AgentLoop` at construction; the default registry contains `read_file`, `write_file`, `bash`.

### 5. Bash tool: `child_process.execFile`, 30 s timeout, 50 KB output cap

`bash` executes the model's `command` string via `execFile('bash', ['-c', command])` with a 30-second timeout and a 50 KB stdout/stderr cap. Output exceeding the cap is truncated with a notice. No allowlist or sandbox — same as Claude Code. The tool returns stdout + stderr combined as a string.

**Alternative considered:** `exec` (shell-interpolated). `execFile` with `-c` is equivalent for arbitrary shell commands and slightly harder to misuse. Accepted.

### 6. Context injection: assembled once per session, prepended as system message

`buildSystemPrompt()` runs at session start (before the first model call) and produces a string containing:
- Absolute cwd
- Shallow file tree (2 levels, respecting `.gitignore` via `git ls-files --others --cached`)
- Git branch and short status (`git status --short --branch`)

The result is set as `PromptContext.system` on every call through the loop. It is not re-assembled mid-session — the file tree is a starting snapshot, not a live view.

### 7. `AgentEvent` union in `core`

```ts
type AgentEvent =
  | { type: "text-delta";   delta: string }
  | { type: "tool-call";    id: string; toolName: string; args: unknown }
  | { type: "tool-result";  id: string; toolName: string; result: string }
  | { type: "routing";      step: number; tier: Tier; model: string; score: number }
  | { type: "error";        message: string }
  | { type: "done" }
```

`Dispatcher.dispatch()` return type changes from `Promise<DispatchResult>` (where `DispatchResult = { textStream }`) to `AsyncIterable<AgentEvent>`. This is a breaking change to the interface.

## Risks / Trade-offs

- **Breaking `Dispatcher` interface** → the CLI `dispatch` command and TUI both consume `DispatchResult`; both must be updated in the same change. The CLI command can print tool calls to stderr and text to stdout.
- **Per-step scoring cost** → scoring on every step adds latency (~1 ms for the heuristic scorer, negligible). Acceptable.
- **Bash tool is powerful** → no sandbox. A confused or malicious model could run destructive commands. Acceptable for a local developer tool at POC stage; document clearly.
- **File tree at session start is stale** → if the model creates files during the session, the system prompt won't reflect them. The model can use `read_file`/`bash ls` to check. Acceptable.
- **`streamText` with `maxSteps: 1` in a manual loop** → more verbose than letting the SDK manage steps, but required for per-step model selection. The loop logic lives entirely in `AgentLoop`, keeping it testable.

## Open Questions

- Should the TUI show the routing decision for each agent step, or only for the initial user turn? (Proposal says each step — confirm this is the right UX before implementing TurnView changes.)
- Output cap for bash: 50 KB sufficient? Claude Code uses similar limits.
