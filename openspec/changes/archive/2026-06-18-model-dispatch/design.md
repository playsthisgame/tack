## Context

Tack scores prompts and logs decisions, but never calls a model — the `score` command
ends at the routing decision. Phase 1 ("Tack as client") requires Tack to own the full
loop: score → select model → call it → stream the answer. This change adds that, and the
streaming contract it defines is what the upcoming TUI will render.

Constraints from the project:
- `core` must contain no provider- or delivery-specific code; the scorer stays pure.
- Models are configured as `provider/model` strings in `defaultConfig.tierModels`
  (e.g. `anthropic/claude-sonnet-4.6`); Tack ships no hardcoded model list.
- Provider keys come from the environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `GOOGLE_GENERATIVE_AI_API_KEY` per `.env.example`).
- Stack mandates the Vercel AI SDK (`ai`) calling provider APIs directly.

## Goals / Non-Goals

**Goals:**
- A `Dispatcher` interface in `core` (pure types) and an `AiSdkDispatcher` implementation
  that streams a response for the routed model.
- Provider resolution from the `provider/model` string, with clear errors for unknown
  providers and missing keys.
- A `tack dispatch "<prompt>"` command that scores, shows the decision, logs it, and
  streams the answer.

**Non-Goals:**
- Outcome-signal logging (tokens used, retries, latency) — out of scope per the
  `decision-logging` spec; the dispatch result may expose usage, but persisting it is a
  later change.
- Multi-turn conversation state / history management at the CLI (single-shot dispatch).
- Tool calling, structured output, or system-prompt templating.
- Retry/backoff and rate-limit handling beyond surfacing the provider's error.

## Decisions

### Decision: `Dispatcher` interface in `core`, implementation in a new `@tack/dispatch` package

Define in `core/src/types.ts`:

```
interface DispatchResult { textStream: AsyncIterable<string>; }
interface Dispatcher { dispatch(model: string, context: PromptContext): Promise<DispatchResult>; }
```

Implement `AiSdkDispatcher` in a new `packages/dispatch` (`@tack/dispatch`) that depends
on `ai` and the provider SDKs.

- **Why a new package, not `core`**: `core` is explicitly "no provider code." The AI SDK
  and `@ai-sdk/*` providers are provider code, so they cannot live in `core`. A dedicated
  package (rather than burying it in the CLI) gives the TUI a reusable dispatcher later —
  the same reason scoring lives apart from the CLI.
- **Why interface in `core`**: matches the established swap-point pattern
  (`Scorer`, `Tokenizer`, `DecisionLog`). Callers depend on the abstraction; `core` holds
  only pure types and imports no SDK.
- **Alternative considered**: put the dispatcher in the CLI package. Rejected — the TUI
  would then either duplicate it or depend on the CLI binary.

### Decision: Provider resolution via a `provider/model` split and a small registry

`AiSdkDispatcher` splits the model string on the first `/` into `provider` and `modelId`,
then looks `provider` up in a registry mapping `"anthropic" | "openai" | "google"` to the
corresponding `@ai-sdk/*` factory. An unknown provider throws a typed error naming the
value; a missing `/` is treated as an invalid model string.

- **Why a registry**: keeps provider knowledge in one swappable table, honoring "no
  hardcoded model list" — only the *provider* dialects are known, model ids stay
  config-driven.
- **Alternative considered**: the AI SDK gateway/registry string form. Deferred to keep
  the dependency surface minimal and key handling explicit per provider.

### Decision: Stream via the AI SDK's `streamText`, expose only `textStream`

`AiSdkDispatcher.dispatch` calls `streamText({ model, messages })` and returns its
`textStream` adapted to `AsyncIterable<string>`. The CLI iterates it and writes chunks to
stdout as they arrive.

- **Why expose only text**: keeps the `Dispatcher` contract delivery-agnostic and free of
  AI SDK types, so the TUI and any future consumer depend on a plain async string stream.
- `PromptContext` (system + history + prompt) maps to the AI SDK `messages` array, so the
  same context the scorer measured is what gets sent.

### Decision: Key presence checked before the call; errors never echo key values

Before dispatching, resolve the env var for the chosen provider and fail fast with a
message naming the missing variable (e.g. "ANTHROPIC_API_KEY is not set"). Provider/network
errors are caught and reported as messages only — never interpolating the key.

- **Why pre-check**: a clear "set ANTHROPIC_API_KEY" beats an opaque SDK 401, and avoids a
  wasted round trip.

### Decision: `dispatch` reuses the `score` decision flow and logger

The command runs the same scoring + `SqliteDecisionLog` path as `score`, prints the
decision header first, then streams. `--no-log` and `TACK_DB_PATH` behave as they do for
`score`.

- **Why**: inspectability and logging are first-class for every routing decision,
  dispatched or not; reusing the path keeps behavior consistent and avoids divergence.

## Risks / Trade-offs

- **Real network calls + cost**: dispatch spends real tokens/money → it is opt-in (a
  separate command from `score`), requires an explicit key, and prints the chosen model
  first so the user sees the cost tier before output streams.
- **Provider SDK churn / version drift** → isolate all `@ai-sdk/*` imports in
  `@tack/dispatch` behind the `Dispatcher` interface; a breaking SDK change touches one
  package.
- **Approximate token counts vs. provider billing** → unchanged from existing tokenizer
  caveat; routing is coarse and this change does not claim billing accuracy.
- **Streaming partial output then error** → if the provider errors mid-stream, already
  printed text stays; the command reports the error after. Acceptable for a CLI; the TUI
  can render this more gracefully later.
- **Adding three provider packages enlarges the dependency tree** → acceptable; they match
  the keys already documented in `.env.example`, and unused providers are never invoked.

## Migration Plan

Additive. New package and a new command; no existing data or behavior changes. `bun
install` pulls the new dependencies. Rollback is dropping the `@tack/dispatch` dependency
and the `dispatch` command; `score` and logging are unaffected.

## Open Questions

- Should `dispatch` accept history/system input (file or flag) for multi-turn context, or
  stay single-shot for the POC? Proposing single-shot now; the `Dispatcher` interface
  already takes a full `PromptContext`, so adding input plumbing later is non-breaking.
- Exact provider set at launch: Anthropic + OpenAI + Google (matching `.env.example`).
  Others can be added to the registry without interface changes.
