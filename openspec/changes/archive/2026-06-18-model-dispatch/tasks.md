## 1. Dispatcher contract in core

- [x] 1.1 Add `DispatchResult` (`{ textStream: AsyncIterable<string> }`) and `Dispatcher`
  (`dispatch(model: string, context: PromptContext): Promise<DispatchResult>`) to
  `packages/core/src/types.ts`, documented as the delivery swap point
- [x] 1.2 Confirm `core` adds no provider/SDK imports — types only (the interface is
  exported via the existing `export * from "./types"`)

## 2. @tack/dispatch package

- [x] 2.1 Scaffold `packages/dispatch` (`package.json` as `@tack/dispatch`, `tsconfig.json`,
  `src/index.ts`) depending on `@tack/core`, `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`,
  `@ai-sdk/google`; run `bun install`
- [x] 2.2 Implement a provider registry mapping `anthropic`/`openai`/`google` to their
  `@ai-sdk/*` factories, plus a `provider/model` string splitter that errors on an unknown
  provider or malformed string
- [x] 2.3 Implement `AiSdkDispatcher` implementing `Dispatcher`: resolve provider, check the
  required API key env var is present (fail fast naming the missing var), call `streamText`
  with the messages built from `PromptContext`, and return `textStream`
- [x] 2.4 Ensure provider/network errors are surfaced as messages without interpolating any
  API key value
- [x] 2.5 Export `AiSdkDispatcher` (and the env-var/provider helpers as needed) from
  `packages/dispatch/src/index.ts`

## 3. CLI dispatch command

- [x] 3.1 Add a `dispatch` case to `packages/cli/src/index.ts` that scores the prompt,
  resolves the tier's model, and prints the decision header (tier + model) before output
- [x] 3.2 Log the decision via `SqliteDecisionLog`, honoring `--no-log` and `TACK_DB_PATH`
  (reuse the existing path-resolution/best-effort logging helper)
- [x] 3.3 Call `AiSdkDispatcher.dispatch(...)` and write `textStream` chunks to stdout as
  they arrive
- [x] 3.4 Catch missing-key and provider errors and print an actionable message (no key
  values); exit non-zero on failure
- [x] 3.5 Update CLI usage text to document the `dispatch` command and that it requires the
  relevant provider API key

## 4. Tests

- [x] 4.1 Test the `provider/model` splitter + registry: known providers resolve; unknown
  provider and malformed string raise clear errors (no network)
- [x] 4.2 Test `AiSdkDispatcher` fails fast with a clear message when the required API key
  env var is absent, without making a network call
- [x] 4.3 Test that dispatch builds the AI SDK messages from `PromptContext`
  (system/history/prompt) — inject a fake/stub stream so no real provider is hit
- [x] 4.4 Test that the streamed text is yielded incrementally as `AsyncIterable<string>`
  using the stubbed stream

## 5. Project housekeeping

- [x] 5.1 Update `README.md`: mark model-dispatch done in the roadmap, document
  `tack dispatch` usage and the API-key requirement
- [x] 5.2 Confirm `.env.example` keys cover the supported providers (already present);
  adjust if the provider set changed
- [x] 5.3 Run `bun test` and `bun run typecheck` and confirm both pass
