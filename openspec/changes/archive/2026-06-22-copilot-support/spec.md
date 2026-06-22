# Spec: GitHub Copilot Provider via Device-Flow OAuth

## ADDED Requirements

### Requirement: `/connect` integration for Copilot

Tack SHALL expose Copilot through the existing `/connect` command, but SHALL
route `/connect copilot` to the device-flow auth path rather than the API-key
prompt used by the key-based providers (Anthropic, OpenAI, Google). The existing
key-based providers SHALL be unaffected.

#### Scenario: Connecting a key-based provider is unchanged

- **WHEN** a user runs `/connect` for Anthropic, OpenAI, or Google
- **THEN** Tack prompts for and stores an API key exactly as it does today

#### Scenario: Connecting Copilot uses the device flow

- **WHEN** a user runs `/connect copilot`
- **THEN** Tack does NOT prompt for an API key
- **AND** instead invokes the Copilot device-flow auth path (reusing an OpenCode
  token if present, otherwise running the device flow)
- **AND** stores the resulting auth state in the Copilot auth store rather than
  the API-key store

#### Scenario: Copilot appears as a connectable provider

- **WHEN** a user lists or is offered connectable providers via `/connect`
- **THEN** Copilot is presented alongside the key-based providers
- **AND** is annotated so the user knows it uses browser-based sign-in rather
  than an API key

#### Scenario: Connection status reflects Copilot correctly

- **WHEN** Tack reports which providers are connected
- **THEN** Copilot's status derives from valid Copilot auth state, not from the
  presence of an API key

### Requirement: Device-flow authentication

Tack SHALL authenticate to GitHub using the OAuth device-authorization grant,
using the Copilot editor client ID, and SHALL NOT require registration of a
custom GitHub OAuth application.

#### Scenario: Initiating the device flow

- **WHEN** a user runs the Copilot auth command with no existing valid GitHub
  OAuth token
- **THEN** Tack requests a device code from
  `https://github.com/login/device/code` using client id
  `Iv1.b507a08c87ecfe98` and scope `read:user`
- **AND** displays the returned `user_code` and `verification_uri` to the user

#### Scenario: Polling for authorization

- **WHEN** the user has been shown a user code and Tack is polling the
  access-token endpoint
- **THEN** Tack polls
  `https://github.com/login/oauth/access_token` at the interval returned by the
  device-code response
- **AND** continues polling on `authorization_pending`
- **AND** increases its delay by the documented backoff on `slow_down`
- **AND** stops with a clear error on `expired_token` or `access_denied`
- **AND** on success persists the returned GitHub OAuth token

#### Scenario: All GitHub requests use JSON

- **WHEN** Tack calls any GitHub OAuth endpoint
- **THEN** it sends `Accept: application/json` so responses are JSON rather than
  form-encoded

### Requirement: Reuse of existing OpenCode credentials

Tack SHALL detect and reuse an existing GitHub OAuth token from OpenCode's local
auth store when present and valid, allowing already-authenticated users to skip
the device flow.

#### Scenario: Existing token found

- **WHEN** the Copilot auth command runs and a valid GitHub OAuth token is found
  in OpenCode's auth store
- **THEN** Tack reuses that token without initiating the device flow
- **AND** records it in Tack's own auth store

#### Scenario: No existing token

- **WHEN** no OpenCode token is found or the found token is invalid
- **THEN** Tack falls back to the device flow

### Requirement: Copilot token exchange and caching

Tack SHALL exchange the GitHub OAuth token for a short-lived Copilot bearer
token and SHALL cache it with its expiry, refreshing before expiry.

#### Scenario: First request needs a Copilot token

- **WHEN** a dispatch to Copilot is requested and no cached Copilot token exists
- **THEN** Tack exchanges the GitHub OAuth token at the Copilot token endpoint
- **AND** caches the returned bearer token together with its expiry timestamp

#### Scenario: Cached token still valid

- **WHEN** a dispatch to Copilot is requested and a cached Copilot token has not
  yet reached its expiry threshold
- **THEN** Tack reuses the cached token without a new exchange

#### Scenario: Cached token near expiry

- **WHEN** a dispatch to Copilot is requested and the cached token is within the
  refresh threshold of its expiry
- **THEN** Tack performs a fresh exchange before issuing the request

### Requirement: AI-SDK-compatible provider

Tack SHALL expose Copilot to the dispatcher as a standard AI-SDK
`LanguageModel`, constructed from the OpenAI-compatible provider, requiring no
Copilot-specific branching in dispatcher code.

#### Scenario: Building the provider

- **WHEN** `createCopilotProvider()` is called with a valid Copilot bearer token
- **THEN** it returns a model handle built via `createOpenAICompatible` pointed
  at the Copilot completions base URL
- **AND** every request carries the configured editor headers
  (`Copilot-Integration-Id`, `Editor-Version`, `Editor-Plugin-Version`,
  `User-Agent`)

#### Scenario: Dispatcher uses Copilot like any other provider

- **WHEN** the router selects a Copilot-backed tier
- **THEN** the dispatcher invokes the returned `LanguageModel` through the same
  call path it uses for other providers, with no Copilot-specific code

### Requirement: Secret handling

Tack SHALL treat the GitHub OAuth token and the Copilot bearer token as secrets
and SHALL NOT expose them in routing logs or inspectable routing-decision
output.

#### Scenario: Tokens excluded from inspectable output

- **WHEN** a routing decision is logged or rendered for inspection
- **THEN** neither the GitHub OAuth token nor the Copilot bearer token appears in
  that output

#### Scenario: Auth state stored separately

- **WHEN** Copilot auth state is persisted
- **THEN** it is written to a dedicated auth store, separate from the routing-log
  store

### Requirement: Configurable endpoints and headers

Tack SHALL read Copilot endpoints and editor headers from config, with public
`github.com` / `api.githubcopilot.com` defaults, so upstream changes and
enterprise hosts require no code change.

#### Scenario: Defaults applied

- **WHEN** no Copilot endpoint or header overrides are present in config
- **THEN** Tack uses the public GitHub and Copilot hosts and the default editor
  headers

#### Scenario: Overrides honored

- **WHEN** config supplies endpoint or header overrides
- **THEN** Tack uses the overridden values for all Copilot requests
