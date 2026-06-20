## Context

Phase 1 is "Tack as client": the user interacts through the TUI, which owns the full
context window and dispatches to a model. The supporting pieces already exist and are
proven from the CLI:

- `HeuristicScorer` turns a `PromptContext` (system + history + prompt) into a
  `RoutingDecision` with tier, score, token count, and a signal breakdown.
- `defaultConfig.tierModels` maps the chosen tier to a `provider/model` string.
- `AiSdkDispatcher.dispatch(model, context)` streams the response as
  `AsyncIterable<string>` and reads provider keys from an injectable `env`.
- `SqliteDecisionLog.record(...)` persists each decision.

The TUI's job is to compose these into an interactive loop and make the routing visible.
This design covers both the interface (`tui-shell`) and the credential layer
(`credential-management`) the interface needs.

## Goals / Non-Goals

**Goals:**
- An Ink app, Claude Code / opencode-inspired: scrolling transcript, persistent input,
  status line, keyboard-driven.
- Show the **selected tier + model per turn, before the response streams**, with the
  signal breakdown available on demand.
- Multi-turn sessions: history feeds both scoring and dispatch, so routing can change
  turn to turn and the user sees it.
- Reuse scoring, logging, and dispatch unchanged; inject them for testability.
- In-app credential entry without editing dotfiles; secrets kept out of the scoring
  config.

**Non-Goals (first cut):**
- OS keychain integration (later; the resolver is designed to accommodate it).
- Editing routing weights/`tierModels` from within the TUI.
- Tool calling, file attachments, slash commands, persistent session resume across
  launches.
- Mouse support; this is keyboard-first like its inspirations.

## Decisions

### Decision: `tack` with no subcommand launches the TUI

The CLI bin (`packages/cli`) is the single `tack` entry point. Its no-command branch —
which currently prints usage — instead launches the TUI, making the interactive client
the default experience. `score`/`dispatch` stay as explicit subcommands and `--help`
still prints usage.

To avoid paying Ink/React startup cost on every `tack score`, the CLI **lazily
`import()`s** `@tack/tui` only inside the no-command branch. So `cli` gains a dependency
on `@tack/tui` (dependency direction `cli → tui → dispatch → core`, no cycle), but the
heavy module is never loaded for the lightweight subcommands.

- **Alternative considered**: a separate `tack-tui` bin/script. Rejected as the primary
  path — the user asked for bare `tack` to start the TUI; a static import would also slow
  `score`/`dispatch`. A `tack-tui` alias can still be added but is not required.

### Decision: Component tree with injected services

```
<App services={{ scorer, dispatcher, log, resolveKey }}>
  <Transcript turns={turns} />        // scrolling history of turns
     <Turn>                           // one user prompt + its decision + response
        <ModelBadge tier model />     // "frontier · anthropic/claude-opus-4.8"
        <Why contributions /> (toggle)
        <ResponseText text streaming />
     </Turn>
  <KeyPrompt /> (only when a required key is missing)
  <Input onSubmit={...} />            // persistent prompt box (ink-text-input)
  <StatusBar />                       // model of last/next turn, hints
</App>
```

A `useTack` hook holds session state (`turns`, streaming buffer, status) and orchestrates
submit. Services are passed in as props/context, not imported as singletons, so tests can
inject fakes (a stub scorer/dispatcher) and assert on rendered output via
`ink-testing-library`.

- **Why injected, not imported**: the dispatcher makes real network calls; injection is
  the only way to test the loop deterministically, and it mirrors the seam the CLI and
  tests already use on `AiSdkDispatcher`.

### Decision: Submit flow — score, reveal model, then stream

On submit:
1. Build `PromptContext` from the session: prior turns → `history`, the new input →
   `prompt` (plus optional `system`).
2. `await scorer.score(context)` → append a turn rendering the **ModelBadge immediately**
   (this is the feature: the model is visible before any answer).
3. `log.record(context, decision, model)` (best-effort, same as CLI).
4. Resolve the provider key (see credential layer). If missing → show `<KeyPrompt>` and
   pause before dispatch.
5. `dispatcher.dispatch(model, context)` → iterate `textStream`, appending chunks to the
   turn's response so tokens appear as they arrive.

- **Why reveal before streaming**: the product promise is seeing *where* a prompt routed
  and *why*, in the moment — not after. The badge and optional "why" render from the
  `RoutingDecision` the moment scoring returns, independent of the model call.

### Decision: "Why" is on-demand, not always shown

The signal breakdown is one keypress away (toggle on the focused turn) rather than always
visible, to keep the transcript readable — but it is always *available*, preserving
inspectability.

- **Alternative considered**: always render the full breakdown. Rejected — it drowns the
  conversation; Claude Code / opencode keep the chat clean and surface detail on demand.

### Decision: Multi-turn history carried in `PromptContext`

The session accumulates turns; each new prompt is scored and dispatched with prior turns
as `history`. This is why scoring lives on a full `PromptContext` rather than a bare
string — the TUI is the first consumer to exercise it. A later turn may route to a
different tier (e.g. conversation depth raises the score), and the per-turn badge makes
that shift visible.

---

### Credential layer (`credential-management`)

> Carried forward from the earlier seed of this change; the dispatcher already exposes
> the `env` seam this design depends on.

#### Decision: Keys are secrets, kept OUT of the scoring config

`core/src/config.ts` (tierModels, weights, thresholds) is tunable, shareable, possibly
committed. API keys must live in a **separate secrets store**, never in that file —
otherwise sharing a routing setup leaks the key.

#### Decision: Layered key resolution, env-first

Resolve each provider's key by checking, in order:
1. **Environment / `.env`** — existing CLI/CI/power-user path; works today.
2. **Local secrets file** — what the in-app `<KeyPrompt>` writes to (e.g.
   `~/.config/tack/credentials`, perms 0600), separate from the scoring config.
3. **OS keychain** — later.

A `resolveKey(provider)` helper walks these layers and returns the key (or undefined); its
result is passed into `AiSdkDispatcher`'s `env` option, so the dispatcher is unchanged.

#### Decision: Ask only for the keys the config actually uses

On launch the TUI reads `tierModels`, extracts the referenced providers (same
`provider/model` parse the dispatcher uses), and resolves their keys. It only prompts for
a key when the user dispatches a model whose key is missing, offering "save for next
time".

```
submit prompt
   │  score → show ModelBadge (tier + model)         ← visible regardless of keys
   ▼
resolveKey(provider): env/.env → secrets file → (later) keychain
   ├─ present ──────────► dispatch + stream response
   └─ missing ──────────► <KeyPrompt> (paste ▸ [save]) → write secrets file → dispatch
```

## Risks / Trade-offs

- **TUIs are hard to test** → keep logic in `useTack`/services and render thin components;
  test via `ink-testing-library` with injected fake scorer/dispatcher, asserting the badge,
  streamed text, and key-prompt appear. Don't test against real providers.
- **Streaming + React re-renders can flicker or lag** → append to a buffer and update
  state per chunk (coarsely batched if needed); acceptable for a POC, revisit if janky.
- **Secret on disk in plaintext** → 0600 perms, gitignore the project-local form, never
  log or render the key; consistent with the plaintext prompt-log trade-off already
  accepted in `decision-logging`. Keychain later.
- **Two config locations (scoring config vs. secrets)** → make the split explicit in the
  UI ("Routing" vs. "Credentials") and docs; deliberate cost of secret-free shareable
  config.
- **Scope creep** (the inspirations are mature tools) → first cut is the single loop
  above; slash commands, attachments, and session resume are explicit non-goals.

## Migration Plan

Additive in capability, with one behavior change: bare `tack` now launches the TUI instead
of printing usage (usage moves to `tack --help`). Replaces the `@tack/tui` placeholder and
adds Ink input/test deps; `cli` gains a lazy dependency on `@tack/tui`. The dispatcher and
the `score`/`dispatch` subcommands are otherwise untouched, and env/`.env` remains the
baseline key source, so absence of the secrets file just means layer 1 is the only source.
Rollback is restoring the usage-on-no-args branch and removing the TUI implementation.

## Open Questions

- Secrets file location: global (`~/.config/tack/credentials`, XDG) vs. project-local
  (gitignored). Leaning global as default ("set once in the app").
- Should `resolveKey`/the secrets store live in `@tack/dispatch` (so the CLI can read it
  too) rather than in the TUI? Leaning `@tack/dispatch`, since it is delivery-agnostic and
  the CLI would benefit — but it can start in the TUI and move.
- System prompt: fixed default, or user-editable in-session? Proposing a simple default
  for the first cut.
