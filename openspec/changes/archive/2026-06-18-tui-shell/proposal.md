## Why

Phase 1's premise is "Tack as client": a person interacts with Tack directly through
its TUI. Everything underneath now works from the CLI — scoring, decision logging, and
streaming dispatch — but the TUI package is still an empty placeholder, so there is no
way to actually *use* Tack as the interactive tool it is meant to be. The TUI is what
turns the pieces into a product and makes the core promise visible in the moment it
matters: **you can see which model your prompt was routed to, and why, as you work.**

## What Changes

- Implement `@tack/tui` as an interactive Ink application, taking Claude Code and
  opencode as UX inspiration: a scrolling conversation transcript with a persistent
  prompt input at the bottom and a status line, driven by the keyboard.
- For each prompt the user submits, the TUI scores it, **displays the selected tier and
  model up front** (the headline feature), then dispatches to that model and streams the
  response inline. The signal breakdown ("why") is available on demand so routing stays
  inspectable.
- Carry conversation history into the `PromptContext`, so both scoring and dispatch see
  the full context of a multi-turn session — and so a later turn can route to a
  different model than an earlier one, visibly.
- Persist each routing decision via the existing `SqliteDecisionLog`, exactly as the CLI
  does.
- Add an in-app **credential layer**: resolve provider API keys without editing dotfiles,
  prompting inline for a missing key when the user dispatches a model whose key is
  absent, and keeping secrets out of the inspectable scoring config. (Design carried
  forward from the earlier seed of this change.)

## Capabilities

### New Capabilities
- `tui-shell`: The interactive Ink interface — prompt input, the per-turn selected-model
  display with on-demand "why", streamed model responses, and multi-turn session state.
- `credential-management`: Resolving provider API keys from layered sources and entering
  a missing key in-app, separate from the scoring config.

### Modified Capabilities
<!-- None. The TUI consumes the existing scoring, logging, and dispatch capabilities
     unchanged; AiSdkDispatcher already accepts an injected `env`, which is the seam the
     credential layer feeds. -->

## Impact

- **`packages/tui`**: real implementation replacing the placeholder; depends on
  `@tack/core`, `@tack/dispatch`, `ink`, `react`, and adds `ink-text-input` (input field)
  plus `ink-testing-library` (dev) for component tests.
- **New dependency on `@tack/dispatch`** from the TUI package (and a tsconfig reference);
  the `cli` package gains a lazy (`import()`) dependency on `@tack/tui` to launch it.
- **Credentials**: introduces a local secrets store distinct from `core/src/config.ts`;
  resolution is env/`.env` first, then the secrets file.
- **Entry point**: running `tack` with no subcommand launches the TUI (the default
  "Tack as client" experience). `tack score`/`tack dispatch` remain explicit subcommands,
  and `tack --help` still prints usage. The TUI is loaded lazily so the CLI subcommands
  don't pay Ink's startup cost.
- **Behavior change**: bare `tack` now launches the TUI instead of printing usage; usage
  moves to `tack --help`. The `score`/`dispatch` subcommands and the dispatcher's
  `env`-based key resolution are otherwise unchanged.
