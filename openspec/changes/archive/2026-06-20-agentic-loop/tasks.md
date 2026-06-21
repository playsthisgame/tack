## 1. Core types in @tack/core

- [x] 1.1 Define `AgentEvent` union type (`text-delta`, `tool-call`, `tool-result`, `routing`, `error`, `done`) in `packages/core/src/types.ts`
- [x] 1.2 Update `Dispatcher` interface: change return type of `dispatch()` from `Promise<DispatchResult>` to `AsyncIterable<AgentEvent>`
- [x] 1.3 Remove `DispatchResult` type (or alias it for backwards compat in CLI only)
- [x] 1.4 Export `AgentEvent` from `packages/core/src/index.ts`

## 2. Context injection

- [x] 2.1 Create `packages/dispatch/src/context.ts` with `buildSystemPrompt(cwd?: string): Promise<string>`
- [x] 2.2 Implement cwd line (absolute path from `process.cwd()`)
- [x] 2.3 Implement shallow file tree (2-level `git ls-files --others --cached` or fallback `find` if not in a git repo)
- [x] 2.4 Implement git context (`git branch --show-current` + `git status --short`), graceful if not a git repo
- [x] 2.5 Export `buildSystemPrompt` from `packages/dispatch/src/index.ts`

## 3. Tool registry

- [x] 3.1 Create `packages/dispatch/src/tools.ts` with `ToolRegistry` type and `defaultToolRegistry`
- [x] 3.2 Implement `read_file` tool: reads file at given path, returns contents or error string
- [x] 3.3 Implement `write_file` tool: writes content to path (creates parent dirs), returns confirmation or error string
- [x] 3.4 Implement `bash` tool: `execFile('bash', ['-c', command])` with 30 s timeout and 50 KB output cap, returns combined stdout+stderr
- [x] 3.5 Export `defaultToolRegistry` and `ToolRegistry` from `packages/dispatch/src/index.ts`

## 4. AgentLoop

- [x] 4.1 Create `packages/dispatch/src/agent-loop.ts` with `AgentLoop` class
- [x] 4.2 Constructor accepts `{ registry, env, scorer, config, streamText? }` (scorer + config for per-step routing)
- [x] 4.3 Implement `run(context: PromptContext): AsyncIterable<AgentEvent>` — the manual step loop
- [x] 4.4 Each iteration: score accumulated context → select model → call `streamText` with `maxSteps: 1` + tools → emit events from `fullStream`
- [x] 4.5 Translate AI SDK `fullStream` events to `AgentEvent` types
- [x] 4.6 Emit `routing` event at the start of each step with tier, model, score, and step number
- [x] 4.7 After each step, collect tool calls, execute via registry, build tool result messages for next step
- [x] 4.8 Terminate loop when step produces no tool calls (final response) or step limit (default 20) is reached
- [x] 4.9 Emit `done` event as the last event in all exit paths
- [x] 4.10 Catch all errors and emit `error` event rather than throwing

## 5. Update AiSdkDispatcher

- [x] 5.1 Replace `streamText` single-call implementation with delegation to `AgentLoop.run()`
- [x] 5.2 Inject `buildSystemPrompt()` result into `context.system` before passing to `AgentLoop`
- [x] 5.3 Update `AiSdkDispatcherOptions` to accept `toolRegistry` and `scorer`+`config` overrides
- [x] 5.4 Export `AgentLoop` from `packages/dispatch/src/index.ts`

## 6. Update CLI dispatch command

- [x] 6.1 Update `cmdDispatch` in `packages/cli/src/index.ts` to consume `AsyncIterable<AgentEvent>` instead of `textStream`
- [x] 6.2 Print `text-delta` events to stdout
- [x] 6.3 Print `tool-call` and `tool-result` events to stderr with a clear prefix
- [x] 6.4 Print `routing` events to stderr (tier · model · score) for each step
- [x] 6.5 Exit 1 on `error` event

## 7. Update TUI — useTack.ts

- [x] 7.1 Add `steps: AgentStep[]` to `Turn` type, where `AgentStep = { tier, model, score, toolCalls: ToolCallEntry[], response: string }`
- [x] 7.2 Replace `streamInto()` with `runAgent()` that consumes `AsyncIterable<AgentEvent>`
- [x] 7.3 On `routing` event: push new step onto `turn.steps`
- [x] 7.4 On `text-delta` event: append to the current step's `response`
- [x] 7.5 On `tool-call` event: push tool call entry onto current step's `toolCalls`
- [x] 7.6 On `tool-result` event: attach result to matching tool call entry by ID
- [x] 7.7 On `done` or `error` event: set `turn.done = true` and `turn.inFlight = false`

## 8. Update TUI — app.tsx

- [x] 8.1 Replace `TurnView`'s single `ModelBadge` with per-step badges from `turn.steps`
- [x] 8.2 Add `ToolCallView` component: shows tool name and condensed args (one line)
- [x] 8.3 Add `ToolResultView` component: shows result summary (first 120 chars, dimmed)
- [x] 8.4 Render tool calls and results inline within each step in `TurnView`
- [x] 8.5 Accumulate response text across all steps for display (concat step responses)

## 9. Update services.ts

- [x] 9.1 Pass `scorer` and `defaultConfig` into `AiSdkDispatcher` constructor so `AgentLoop` can score per-step

## 10. Smoke test

- [x] 10.1 Run `tack dispatch "what language is this project written in?"` and confirm it reads files and answers correctly
- [x] 10.2 Launch `tack` TUI, ask the same question, confirm tool calls appear inline and response is correct
- [x] 10.3 Confirm per-step routing badges show in TUI for a multi-step turn
