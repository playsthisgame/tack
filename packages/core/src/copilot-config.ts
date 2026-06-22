/**
 * All Copilot endpoints, identifiers, and editor headers live here with public
 * defaults, never as magic strings in the auth/provider logic. Copilot rejects
 * requests missing the editor headers, and upstream bumps the editor versions
 * over time, so they must be tunable without a code change. Enterprise hosts
 * become a config override rather than a code change (proposal "Out of Scope").
 */
export interface CopilotConfig {
  /**
   * The well-known Copilot editor OAuth client id. Registering a custom GitHub
   * OAuth app would yield a token WITHOUT Copilot entitlements, so reusing the
   * editor client id is both required and sufficient.
   */
  clientId: string;
  /** OAuth scope requested in the device flow. */
  scope: string;
  /** GitHub device-authorization endpoint (returns the user/device codes). */
  deviceCodeUrl: string;
  /** GitHub access-token endpoint polled during the device flow. */
  accessTokenUrl: string;
  /** Copilot token-exchange endpoint: trades the GitHub OAuth token for a bearer. */
  tokenExchangeUrl: string;
  /** Copilot completions base URL — the OpenAI-compatible inference host. */
  completionsBaseUrl: string;
  /**
   * Editor headers Copilot's endpoint requires on every request. Sent verbatim;
   * track upstream editor-version bumps by overriding these in config.
   */
  editorHeaders: {
    "Copilot-Integration-Id": string;
    "Editor-Version": string;
    "Editor-Plugin-Version": string;
    "User-Agent": string;
  };
  /**
   * Seconds before a Copilot bearer token's expiry at which it is considered
   * stale and refreshed. The bearer lives ~30 min; refreshing inside this
   * window avoids dispatching with an about-to-expire token.
   */
  refreshThresholdSeconds: number;
}

/**
 * Public-host defaults. With no overrides Tack talks to `github.com` /
 * `api.githubcopilot.com` and presents itself with the default editor headers.
 */
export const defaultCopilotConfig: CopilotConfig = {
  clientId: "Iv1.b507a08c87ecfe98",
  scope: "read:user",
  deviceCodeUrl: "https://github.com/login/device/code",
  accessTokenUrl: "https://github.com/login/oauth/access_token",
  tokenExchangeUrl: "https://api.github.com/copilot_internal/v2/token",
  completionsBaseUrl: "https://api.githubcopilot.com",
  editorHeaders: {
    "Copilot-Integration-Id": "vscode-chat",
    "Editor-Version": "vscode/1.95.0",
    "Editor-Plugin-Version": "copilot-chat/0.22.0",
    "User-Agent": "GitHubCopilotChat/0.22.0",
  },
  refreshThresholdSeconds: 300,
};
