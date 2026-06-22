import type { CopilotConfig } from "./copilot-config";
import type { FetchLike } from "./copilot-device-flow";

/** A Copilot bearer token together with its absolute expiry (unix epoch seconds). */
export interface CopilotToken {
  token: string;
  expiresAt: number;
}

/**
 * Raised when the Copilot token endpoint rejects the GitHub OAuth token (401/403).
 * Typed so callers can distinguish "must re-authenticate" from a transient
 * network/server failure and prompt the user to reconnect.
 */
export class GithubTokenRejectedError extends Error {
  constructor(message = "the GitHub OAuth token was rejected — re-authentication is required") {
    super(message);
    this.name = "GithubTokenRejectedError";
  }
}

/**
 * Exchange a GitHub OAuth token for a short-lived Copilot bearer token at the
 * Copilot token endpoint. Returns the bearer and its expiry. Throws
 * `GithubTokenRejectedError` when the GitHub token is rejected (re-auth needed).
 */
export async function exchangeForCopilotToken(
  githubToken: string,
  config: CopilotConfig,
  doFetch: FetchLike = fetch,
): Promise<CopilotToken> {
  const res = await doFetch(config.tokenExchangeUrl, {
    method: "GET",
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: "application/json",
      ...config.editorHeaders,
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new GithubTokenRejectedError();
  }
  if (!res.ok) {
    throw new Error(`Copilot token exchange failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as { token?: string; expires_at?: number };
  if (!data.token) {
    throw new Error("Copilot token exchange returned no token");
  }
  // The endpoint returns an absolute `expires_at`; fall back to ~25 min out if absent.
  const expiresAt = data.expires_at ?? Math.floor(Date.now() / 1000) + 1500;
  return { token: data.token, expiresAt };
}
