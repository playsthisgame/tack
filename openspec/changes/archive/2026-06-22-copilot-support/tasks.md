# Tasks: GitHub Copilot Provider via Device-Flow OAuth

## 1. Config

- [x] 1.1 Add Copilot config section: client id (default `Iv1.b507a08c87ecfe98`),
      scope (`read:user`), GitHub device/token endpoints, Copilot token-exchange
      endpoint, Copilot completions base URL, and editor headers
      (`Copilot-Integration-Id`, `Editor-Version`, `Editor-Plugin-Version`,
      `User-Agent`), all with public defaults.
- [x] 1.2 Add a refresh-threshold setting (seconds before expiry to refresh the
      Copilot token).

## 2. Auth store

- [x] 2.1 Create a dedicated SQLite store for Copilot auth state, separate from
      routing logs.
- [x] 2.2 Schema: account id, GitHub OAuth token, Copilot bearer token, Copilot
      token expiry. Keyed by account id (one row per identity).
- [x] 2.3 Read/write helpers; ensure tokens never get serialized into any
      shared/inspectable output.

## 3. Device flow

- [x] 3.1 Implement device-code request against the GitHub device endpoint with
      `Accept: application/json`.
- [x] 3.2 Implement user-code presentation (return `user_code` +
      `verification_uri` to the caller for display).
- [x] 3.3 Implement access-token polling: honor the returned `interval`, continue
      on `authorization_pending`, back off on `slow_down`, fail clearly on
      `expired_token` / `access_denied`.
- [x] 3.4 Persist the GitHub OAuth token on success.

## 4. OpenCode credential reuse

- [x] 4.1 Locate OpenCode's auth file across known paths
      (`~/.local/share/opencode/auth.json`, macOS Application Support, plus a
      search fallback).
- [x] 4.2 Parse the Copilot entry tolerantly (key/field names have drifted
      across versions); extract the GitHub OAuth (`gho_`) token.
- [x] 4.3 Validate the token; on success record it in Tack's auth store and skip
      the device flow. On failure, fall back to the device flow.

## 5. Copilot token exchange + cache

- [x] 5.1 Implement exchange of the GitHub OAuth token for a Copilot bearer token
      at the Copilot token endpoint.
- [x] 5.2 Cache the bearer token with its expiry; expose `ensureFreshToken()`
      that returns a valid token, refreshing when within the threshold.
- [x] 5.3 Surface a typed error when the GitHub OAuth token is rejected (prompt
      re-auth).

## 6. Provider factory

- [x] 6.1 Add `@ai-sdk/openai-compatible` dependency.
- [x] 6.2 Implement `createCopilotProvider()` that builds a model via
      `createOpenAICompatible` with the Copilot base URL, current bearer token,
      and editor headers injected per request.
- [x] 6.3 Wire the bearer token through `ensureFreshToken()` so each model build
      / request uses a valid token.
- [x] 6.4 Confirm the returned handle satisfies the dispatcher's existing
      `LanguageModel` shape with no Copilot-specific branching.

## 7. Dispatcher integration

- [x] 7.1 Register the Copilot provider for the relevant tiers via config (model
      ids per tier).
- [x] 7.2 Verify a routed prompt dispatches end to end through Copilot.

## 8. `/connect` integration

- [x] 8.1 Add Copilot to the `/connect` provider list, annotated as browser
      sign-in (not API key). Leave the Anthropic/OpenAI/Google key-entry paths
      unchanged.
- [x] 8.2 Branch `/connect copilot` into the device-flow auth path (reuse
      OpenCode token if present, else run the device flow); do not prompt for a
      key.
- [x] 8.3 Write the result to the Copilot auth store, not the API-key store.
- [x] 8.4 Make connection-status output derive Copilot's status from valid auth
      state, without printing secret values.

## 9. Tests

- [x] 9.1 Device-flow polling: pending, slow_down backoff, success, expiry,
      denial (mock GitHub endpoints).
- [x] 9.2 OpenCode reuse: token found/valid, found/invalid, absent.
- [x] 9.3 Token-cache: fresh reuse, near-expiry refresh, rejected GitHub token.
- [x] 9.4 Provider: editor headers present on requests; dispatcher path unchanged.
- [x] 9.5 `/connect` routing: `copilot` enters the device-flow path (no key
      prompt); key-based providers still prompt for and store a key.
- [x] 9.6 Secret handling: tokens absent from routing logs and inspectable
      output.

