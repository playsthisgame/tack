## Why

Today the tier→model mapping is baked into `defaultConfig.tierModels` in `@tack/core`;
changing which model a tier routes to means editing source and rebuilding. Users need to
assign their own models to the `cheap`/`mid`/`frontier` tiers and do it from the TUI —
the same place they already route prompts — without touching code.

## What Changes

- Add a **persisted, user-editable tier→model configuration** loaded over the built-in
  defaults at startup, so routing and dispatch use the user's chosen models. The store is
  separate from the secrets store and from source code (no API keys, no recompile).
- Each tier's entry carries the model string **and the context window and input cost that
  must stay coherent with it** (routing uses the window for feasibility escalation; the
  advisory uses the cost). Changing a tier's model updates the associated window/cost so
  context-aware routing stays correct.
- Validate a model string as `provider/model` against the known provider set before saving;
  an unknown provider is rejected with a clear message rather than persisted.
- Add a **TUI shortcut** (mirroring `^w`) that opens an in-app editor to view the current
  per-tier models and change them. Edits are validated, saved to the config store, and
  applied to subsequent prompts in the same session — no restart.
- `tack` (CLI and TUI) reads the merged configuration instead of the bare `defaultConfig`.

## Capabilities

### New Capabilities

- `tier-model-config`: a persisted, user-editable mapping of each tier to its model (with
  the coherent context window and input cost), loaded and merged over the built-in
  defaults, validated against known providers, and consumed by routing and dispatch.
- `tui-model-config`: an in-app TUI editor, opened by a keyboard shortcut, for viewing and
  changing each tier's model; validates input, persists it via `tier-model-config`, and
  applies it to subsequent prompts without leaving the session.

### Modified Capabilities

<!-- None. context-aware-routing and model-dispatch already treat tier models, windows, and
     costs as configuration; their requirements are unchanged — only the source of that
     configuration becomes a user-editable store rather than a hardcoded default. -->

## Impact

- Affected: `@tack/core` (config load/merge + a config store distinct from secrets;
  per-tier model/window/cost validation and coherence), `@tack/cli` (build scorer/dispatcher
  from the merged config), `@tack/tui` (new shortcut + editor modal, services wiring to
  read/write config and rebuild the dispatcher when models change), and provider-name
  validation shared with `@tack/dispatch`'s registry.
- No new third-party dependencies. The config store is a local JSON file alongside the
  existing `.tack/` data, parallel to the secrets store.
- `^m` is unavailable for the shortcut (terminals deliver Ctrl-M as Enter); the editor
  uses a different control key (design decides the exact binding).
