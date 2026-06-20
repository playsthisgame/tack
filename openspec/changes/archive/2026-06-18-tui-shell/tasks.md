## 1. Package setup

- [x] 1.1 Add `@tack/dispatch` (workspace), `ink-text-input` deps and `ink-testing-library`
  dev dep to `packages/tui/package.json`; add a `../dispatch` reference to its
  `tsconfig.json` and the root `tsconfig.json`; run `bun install`
- [x] 1.2 Add `@tack/tui` (workspace) as a dependency of `packages/cli` and a `../tui`
  tsconfig reference, so the CLI can launch the TUI (the existing root `tack` script stays
  the entry point)

## 2. Credential layer (credential-management)

- [x] 2.1 Implement `resolveKey(provider, { env, secrets })` that checks the environment
  first, then a local secrets store, returning the key or undefined — no key value ever
  logged
- [x] 2.2 Implement the local secrets store: read/write a file (default
  `~/.config/tack/credentials`, perms 0600), keyed by provider, distinct from
  `core/src/config.ts`
- [x] 2.3 Add a helper to derive the set of providers referenced by `defaultConfig.tierModels`
  (reuse the dispatch `parseModelString`) so the UI only asks for keys actually in use
- [x] 2.4 Decide placement per design open question (lean `@tack/dispatch` for CLI reuse);
  export the resolver/store from its package

## 3. TUI components (tui-shell)

- [x] 3.1 Build `<App>` accepting injected services (`scorer`, `dispatcher`, `log`,
  `resolveKey`) and holding session state via a `useTack` hook (turns, streaming buffer,
  status)
- [x] 3.2 Build `<Input>` (ink-text-input) as a persistent prompt box that clears on submit
- [x] 3.3 Build `<Transcript>`/`<Turn>` rendering each turn, with `<ModelBadge>` showing the
  routed tier + model and a togglable `<Why>` for the signal breakdown
- [x] 3.4 Build `<StatusBar>` showing context (e.g. last/next model, key hints)
- [x] 3.5 Build `<KeyPrompt>` shown only when the selected model's key is unresolved; on
  submit it saves via the secrets store and continues dispatch

## 4. Submit flow wiring

- [x] 4.1 On submit: build `PromptContext` from session history + new prompt, call
  `scorer.score`, and append a turn that renders the ModelBadge immediately
- [x] 4.2 Record the decision via `SqliteDecisionLog` (best-effort; failure must not block
  the loop or response)
- [x] 4.3 Resolve the provider key; if missing, show `<KeyPrompt>` and defer dispatch until
  provided
- [x] 4.4 Call `dispatcher.dispatch(model, context)` and append `textStream` chunks to the
  turn's response as they arrive
- [x] 4.5 Export a `runTui()` (or similar) from `@tack/tui` that renders `<App>` with the
  real scorer/dispatcher/log, replacing the placeholder export
- [x] 4.6 In `packages/cli/src/index.ts`, change the no-subcommand branch to lazily
  `import("@tack/tui")` and call `runTui()`; keep `score`/`dispatch` and route `--help`/`-h`
  to usage

## 5. Tests

- [x] 5.1 Test (ink-testing-library, injected fake scorer/dispatcher) that submitting a
  prompt renders the ModelBadge with the routed tier + model before any response
- [x] 5.2 Test that streamed chunks from a stubbed dispatcher appear incrementally in the turn
- [x] 5.3 Test that toggling "why" reveals the signal breakdown for a turn
- [x] 5.4 Test `resolveKey` layering (env hit; secrets-store hit; miss) and that a missing
  key triggers the `<KeyPrompt>` path instead of an error
- [x] 5.5 Test that the provider-derivation helper returns only providers referenced by
  `tierModels`
- [x] 5.6 Test the CLI entry routing: no subcommand invokes the TUI launcher (stubbed),
  while `score`/`dispatch`/`--help` do not

## 6. Project housekeeping

- [x] 6.1 Update `README.md`: mark tui-shell done in the roadmap, document that
  `bun run tack` (no subcommand) launches the TUI and the in-app key entry; note the
  secrets file location
- [x] 6.2 Gitignore the project-local secrets file form if used
- [x] 6.3 Run `bun test` and `bun run typecheck` and confirm both pass
