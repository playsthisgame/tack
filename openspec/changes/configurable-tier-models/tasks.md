# Tasks: Configurable Tier Models

## 1. Core config store & loader

- [x] 1.1 Define a `TierModelOverride` type (`model`, `window`, `costPer1M`) and a
      `TierModelConfig` = partial `Record<Tier, TierModelOverride>`.
- [x] 1.2 Define a `ConfigStore` interface (`load(): TierModelConfig`, `save(tier, override): void`),
      mirroring the existing persistence seams.
- [x] 1.3 Implement `FileConfigStore` writing JSON to `./.tack/config.json`, path overridable
      via `TACK_CONFIG_PATH`; create the parent dir on save.
- [x] 1.4 Tolerate a missing or unparsable config file on load (fall back to empty overrides
      with a warning), mirroring the empty-`seeds.json` behavior.
- [x] 1.5 Implement `loadConfig(store?, base = defaultConfig): ScoringConfig` that merges
      overrides into `tierModels`, `tierWindows`, and `tierCostPer1M` together; untouched
      tiers keep their defaults.
- [x] 1.6 Add a small known-model catalog mapping model ids (at least the default models) to
      `{ window, costPer1M }`; export a lookup used to auto-fill window/cost.
- [x] 1.7 Export the new types/store/loader/catalog from `@tack/core`.

## 2. Provider validation (composition layer)

- [x] 2.1 Add a `validateModelString(model)` helper in `@tack/dispatch` (or reuse
      `parseModelString` + the provider registry) returning ok or a clear error naming an
      unknown provider; keep `@tack/core` free of any `@tack/dispatch` import.

## 3. CLI wiring

- [x] 3.1 Load the merged config via `loadConfig(new FileConfigStore(...))` and use it in
      `score`, `dispatch`, and `route` instead of the bare `defaultConfig`.

## 4. TUI editor & live application

- [x] 4.1 Add a `ModelConfigEditor` modal component listing `cheap`/`mid`/`frontier` and their
      current models, built on the existing `PromptInput` (so `ctrl`/`meta` cannot leak).
- [x] 4.2 Support selecting a tier, editing its model; if the model is in the catalog auto-fill
      window/cost, otherwise reveal a required window field (cost optional).
- [x] 4.3 On confirm, validate via the dispatch validator; on success persist through
      `ConfigStore.save`; on failure show an in-editor error and leave the config unchanged.
- [x] 4.4 Support dismiss (Esc) that closes the editor and returns focus to the prompt with no
      changes.
- [x] 4.5 Bind `^t` in the App input handler to open the editor; confirm it does not type into
      the prompt.
- [x] 4.6 Wire `services` to hold the active `ScoringConfig`, expose read/save of tier models,
      and reset the cached dispatcher (and `modelFor`/badge source) on save so the next prompt
      uses the new models without restart.
- [x] 4.7 Add the `^t` hint to the welcome panel / status bar alongside `^w`.

## 5. Tests

- [x] 5.1 `loadConfig` with no store returns the defaults unchanged.
- [x] 5.2 An override replaces a tier's model, window, and cost coherently in the merged config.
- [x] 5.3 `FileConfigStore` round-trips a saved override; a missing/corrupt file loads as empty
      without throwing.
- [x] 5.4 The catalog auto-fills window/cost for a known model id.
- [x] 5.5 Validation accepts a known provider and rejects an unknown one with a clear message.
- [x] 5.6 TUI: `^t` opens the editor and does not insert a character into the prompt.
- [x] 5.7 TUI: saving a valid model persists it and a subsequent prompt routes to the new model;
      an invalid model shows an error and changes nothing.
- [x] 5.8 TUI: dismissing the editor leaves all tier models unchanged.
