## Context

Tier→model routing is driven by `defaultConfig` in `@tack/core/config.ts`, which holds three
parallel per-tier maps: `tierModels` (the `provider/model` string), `tierWindows` (the
model's context window, used by context-aware-routing's feasibility check), and
`tierCostPer1M` (used by the escalation cost advisory). These are constants; there is no
config file or runtime editing. The composition layers already build their engines from a
`ScoringConfig`: the CLI (`buildScorer`/`AiSdkDispatcher`) and the TUI `services`
(`createServices`). The TUI already has a modal pattern (`KeyPrompt`) and a controlled
`PromptInput` that ignores `ctrl`/`meta` combos, plus `^w`/`^d`/`^c` shortcuts. Provider
validation already exists in `@tack/dispatch` (`parseModelString` + `defaultRegistry`), but
`@tack/core` must not depend on `@tack/dispatch`.

## Goals / Non-Goals

**Goals:**

- Persist per-tier model overrides outside source code and load them merged over defaults.
- Keep each tier's model, window, and cost coherent so routing/advisories stay correct.
- Let the user change tier models from the TUI via a shortcut, applied without restart.
- Validate model strings against the known provider set before persisting.

**Non-Goals:**

- Editing thresholds, keywords, or other `ScoringConfig` fields (models/windows/cost only).
- A general settings UI or config schema migration system.
- Auto-discovering a model's true context window from the provider API.
- Per-project profiles or multi-user/concurrent-edit coordination.

## Decisions

### A config store in `@tack/core`, separate from secrets, parallel to the DB

Add a `ConfigStore` seam (mirroring `DecisionLog`/`LabeledExampleStore`) with a
`FileConfigStore` writing JSON to `./.tack/config.json` (override via `TACK_CONFIG_PATH`),
alongside the existing `./.tack/tack.db`. It stores only **overrides**: a partial map of
`tier -> { model, window, costPer1M }`. A `loadConfig()` helper merges overrides over
`defaultConfig` into a full `ScoringConfig` (untouched tiers keep their defaults).

- _Alternative — store in the SQLite DB:_ rejected; a small human-editable JSON file is
  easier to inspect/edit by hand and keeps routing config decoupled from the decision log.
- _Alternative — user-global `~/.tack/config.json`:_ rejected for v1 to match the existing
  project-local `./.tack/` convention; revisit if cross-project sharing is wanted.

### Model, window, and cost travel together; a small catalog auto-fills known models

The store persists `{ model, window, costPer1M }` per overridden tier, and `loadConfig()`
applies them to all three `ScoringConfig` maps so feasibility and the advisory stay
consistent. The TUI editor's primary field is the **model string**. A small built-in catalog
maps known model ids (the defaults, at minimum) to their `{ window, costPer1M }`:

- If the entered model is in the catalog, window/cost auto-fill.
- If it is not, the editor exposes an explicit **window** field (required) and an optional
  cost field, so routing stays correct for custom models rather than silently reusing the
  previous tier's window.

- _Alternative — model-only editing, reuse existing window:_ rejected; swapping to a
  smaller-window model would make context-aware-routing escalate incorrectly with no signal.

### Provider validation stays in the composition layer

The TUI/CLI (which already import `@tack/dispatch`) validate a model string with
`parseModelString` + the provider registry **before** calling `ConfigStore.save`. The core
store persists already-validated data and does not import `@tack/dispatch`.

- _Alternative — move the provider list into `@tack/core`:_ rejected; provider knowledge
  belongs with the dispatch registry, and the existing `model-dispatch` spec already owns
  "resolve provider from the tier's model string."

### Shortcut `^t`; editor is a modal reusing `PromptInput`

Bind the editor to **`^t`** (Ctrl-T). `^m` is unusable (terminals deliver Ctrl-M as Enter);
`^w`/`^d`/`^c` are taken. The editor renders like `KeyPrompt`: a focused panel listing the
three tiers, with row selection and a `PromptInput` per edited field. Because `PromptInput`
already ignores `ctrl`/`meta`, `^t` cannot leak a character (the same class of bug as the
`^w` fix). Esc dismisses without changes; confirming a row validates → persists → updates
the live config.

### Apply mid-session by resetting the cached dispatcher

`services` holds the active `ScoringConfig`. On a saved change it updates that config and
**resets the dispatcher's cached agent loop** (and the `modelFor`/badge source) so the next
prompt rebuilds with the new models. The k-NN embedder and labeled set are unaffected (the
embedding model is independent of the routed model), so only the routed-model config and the
feasibility windows change.

- _Alternative — restart the TUI:_ rejected; the requirement is no-restart application.

## Risks / Trade-offs

- **Unknown model's window is the user's responsibility** → the editor requires a window for
  models not in the catalog; an incorrect value mis-routes feasibility. Mitigation: catalog
  auto-fill for known models + a visible window field + a sane default note for custom ones.
- **Rebuilding the dispatcher mid-session** adds a little latency to the first prompt after a
  change → acceptable; the embedding model is disk-cached and not reloaded.
- **Corrupt/partial `config.json`** → `loadConfig()` tolerates a missing or unparsable file
  by falling back to defaults with a warning, mirroring the empty-`seeds.json` tolerance.
- **Last-write-wins across processes** (CLI and a running TUI) → acceptable for a local,
  single-user tool; not coordinating concurrent writers in v1.

## Open Questions

- Should the editor expose cost editing in v1, or only model + window (cost defaulting from
  the catalog or a flat estimate)? Leaning model + window, cost auto-filled.
- Exact in-editor navigation (arrow/Tab between tiers, Enter to edit a row) — finalize during
  implementation against the existing `KeyPrompt` interaction style.
