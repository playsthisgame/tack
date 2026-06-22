# Proposal: GitHub Copilot Provider via Device-Flow OAuth

## Why

Tack must GitHub Copilot an AI service. To dispatch routed prompts through Copilot, Tack needs a
provider that authenticates the way Copilot's editor integrations do, since
Copilot does not issue ordinary API keys. The authentication path — GitHub
device-flow OAuth followed by an exchange for a short-lived Copilot token — has
no off-the-shelf library in our stack and must be implemented from scratch.

The inference path does **not** need to be built from scratch. Copilot's
completions endpoint is OpenAI-compatible, so `@ai-sdk/openai-compatible`
(`createOpenAICompatible`) drives it directly once a valid bearer token and the
required editor headers are supplied. The work that is genuinely missing is
authentication and token lifecycle, not request/response handling.

## What Changes

- Add a new `CopilotAuth` module in `@tack/core` that implements GitHub
  device-flow OAuth end to end: device-code request, user-code presentation,
  access-token polling (handling `authorization_pending` / `slow_down`), and
  persistence of the resulting long-lived GitHub OAuth token.
- Add a Copilot token-exchange + cache layer that trades the GitHub OAuth token
  for a short-lived Copilot bearer token and refreshes it before expiry
  (~30 min lifetime).
- Add a `createCopilotProvider()` factory that returns an AI-SDK-compatible
  model handle, built on `createOpenAICompatible`, with the Copilot base URL,
  bearer token, and required editor headers wired in. The dispatcher consumes
  this through the same `LanguageModel` shape it already uses for other
  providers.
- Reuse an existing GitHub OAuth token from OpenCode's auth store when present,
  so already-authenticated users skip the device flow.
- Persist Copilot auth state in a dedicated SQLite store (separate from routing
  logs), with the GitHub OAuth token treated as a secret.
- Extend the existing `/connect` command to support Copilot. `/connect` today
  is API-key entry for Anthropic, OpenAI, and Google; `/connect copilot` instead
  branches into the device-flow auth path (no key prompt) and writes to the
  Copilot auth store. The key-based providers are unchanged. Copilot is listed
  as a connectable provider, annotated as browser sign-in rather than API key.

## Impact

- Affected packages: `@tack/core` (new auth module + provider factory),
  `@tack/cli` (new auth command).
- New dependency: `@ai-sdk/openai-compatible` (the dispatcher already depends on
  the Vercel AI SDK in library mode).
- New persisted secret: GitHub OAuth token. Requires care in storage and in
  any log/inspection output — it must never appear in routing logs or
  inspectable routing-decision output.
- No change to the `Scorer` interface or routing-decision inspectability; this
  is strictly a dispatch-layer addition.

## Out of Scope

- **GitHub Enterprise / custom Copilot endpoints.** Hardcode the public
  `github.com` / `api.githubcopilot.com` hosts for now. *Seam:* base URLs are
  read from config with public defaults, so enterprise hosts become a config
  change, not a code change.
- **Automatic token-refresh daemon / background renewal.** Refresh is lazy
  (checked at request time). *Seam:* the cache layer exposes an explicit
  `ensureFreshToken()` so a scheduler can call it later without restructuring.
- **Streaming-specific handling beyond what the AI SDK provides.** We rely on
  the OpenAI-compatible provider's streaming. *Seam:* the provider factory
  returns a standard `LanguageModel`, so streaming is already available if the
  dispatcher opts into it.
- **Multi-account Copilot.** One Copilot identity at a time. *Seam:* the auth
  store is keyed by account id, so a second identity is an added row, not a
  schema change.
- **Hand-rolled HTTP inference client.** We deliberately reuse the AI SDK's
  OpenAI-compatible provider rather than writing our own request/response code.
  *Seam:* the dispatcher only sees a `LanguageModel`; swapping in a custom
  client later would not touch dispatcher code.

## Notes / Decisions

- **No GitHub app registration.** The device flow uses the well-known Copilot
  editor client ID (`Iv1.b507a08c87ecfe98`). Registering a custom OAuth app
  would yield a token *without* Copilot entitlements, so reusing the editor
  client ID is both required and sufficient.
- **Editor headers are mandatory.** Copilot's endpoint rejects requests missing
  `Copilot-Integration-Id`, `Editor-Version`, `Editor-Plugin-Version`, and a
  matching `User-Agent`. These live in config so they can track upstream
  editor-version bumps without a code change.
- **ToS caveat (non-technical, must be cleared by user).** This flow
  authenticates Tack as though it were an official Copilot editor integration,
  against an endpoint licensed for IDE use. 
