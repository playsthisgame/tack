## Why

Tack can score a prompt and tell you which model it would route to, but it stops
there — the user still has to copy the prompt into another tool to actually get an
answer. Closing that loop makes Tack a usable client (Phase 1's whole premise: "Tack
as client") and is the prerequisite for the TUI, which needs a streaming response to
display. It also lets us observe real routing in practice instead of just in dry-run
scoring.

## What Changes

- Add the Vercel AI SDK (`ai`) and provider packages as dependencies, calling
  provider APIs directly per the project stack.
- Define a delivery-agnostic `Dispatcher` interface in `core` (pure types, no provider
  code) that turns a chosen model + `PromptContext` into a streaming text response.
- Add an `AiSdkDispatcher` implementation in a new `@tack/dispatch` package that maps
  the tier's `provider/model` string to the right AI SDK provider and streams the
  completion. Provider/key handling lives here, keeping `core` provider-free.
- Extend the CLI with `tack dispatch "<prompt>"`: it scores the prompt, selects the
  tier's model, logs the decision (reusing the existing SQLite logger), then calls the
  model and streams the response to stdout. The routing decision is printed first so
  the user still sees *why* before the answer arrives.
- Surface clear, actionable errors when the required provider API key is missing or the
  provider call fails, without leaking keys.

## Capabilities

### New Capabilities
- `model-dispatch`: Calling the routed model through the AI SDK and streaming its
  response, including provider resolution from the tier's model string and API-key /
  failure handling.

### Modified Capabilities
<!-- None. `decision-logging` is reused as-is; no requirement changes. Outcome-signal
     logging (retries, token usage) remains out of scope per that spec. -->

## Impact

- **New package**: `packages/dispatch` (`@tack/dispatch`) depending on `ai`, the
  provider SDKs, and `@tack/core`.
- **Dependencies added**: `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`,
  `@ai-sdk/google` (providers matching the keys in `.env.example`).
- **`core`**: adds a `Dispatcher` interface and dispatch-related types to its public
  surface — types only, no provider/SDK imports.
- **CLI**: `packages/cli/src/index.ts` gains a `dispatch` command and depends on
  `@tack/dispatch`.
- **Runtime**: `dispatch` makes a real network call and requires the relevant provider
  API key in the environment; `score` remains key-free and offline.
- **No breaking changes**: `score` and existing behavior are untouched; dispatch is
  additive.
