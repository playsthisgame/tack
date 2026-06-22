import {
  DEFAULT_COPILOT_ACCOUNT,
  redactedAuthState,
  type CopilotAuthState,
  type CopilotAuthStore,
} from "./copilot-auth-store";
import { defaultCopilotConfig, type CopilotConfig } from "./copilot-config";
import {
  pollForAccessToken,
  requestDeviceCode,
  type DeviceCodeResult,
  type FetchLike,
  type SleepFn,
} from "./copilot-device-flow";
import { findOpencodeGithubToken } from "./copilot-opencode";
import {
  exchangeForCopilotToken,
  GithubTokenRejectedError,
  type CopilotToken,
} from "./copilot-token";

/** Callbacks the connect flow uses to surface progress (user code) to a UI. */
export interface ConnectCallbacks {
  /** Called with the device/user code so the UI can prompt the user to enter it. */
  onUserCode?: (device: DeviceCodeResult) => void;
}

export interface CopilotAuthOptions {
  store: CopilotAuthStore;
  config?: CopilotConfig;
  accountId?: string;
  fetch?: FetchLike;
  sleep?: SleepFn;
  /** Override OpenCode-token discovery (tests inject a known/absent token). */
  findOpencodeToken?: () => string | undefined;
}

/**
 * Orchestrates the full Copilot auth lifecycle over the dedicated auth store:
 * obtaining a GitHub OAuth token (reusing OpenCode's when valid, else the device
 * flow) and exchanging it for a cached, lazily-refreshed Copilot bearer token.
 *
 * The provider factory consumes only `ensureFreshToken()`; the `/connect`
 * command drives `connect()`.
 */
export class CopilotAuth {
  private readonly store: CopilotAuthStore;
  private readonly config: CopilotConfig;
  private readonly accountId: string;
  private readonly doFetch: FetchLike;
  private readonly sleep?: SleepFn;
  private readonly findOpencodeToken: () => string | undefined;

  constructor(options: CopilotAuthOptions) {
    this.store = options.store;
    this.config = options.config ?? defaultCopilotConfig;
    this.accountId = options.accountId ?? DEFAULT_COPILOT_ACCOUNT;
    this.doFetch = options.fetch ?? fetch;
    this.sleep = options.sleep;
    this.findOpencodeToken = options.findOpencodeToken ?? findOpencodeGithubToken;
  }

  /** Redacted (secret-free) view of stored auth state, safe for status output. */
  status(): ReturnType<typeof redactedAuthState> {
    return redactedAuthState(this.current());
  }

  /** True when a usable GitHub OAuth token is already stored. */
  isConnected(): boolean {
    return Boolean(this.current()?.githubToken);
  }

  private current(): CopilotAuthState | undefined {
    return this.store.get(this.accountId) ?? this.store.first();
  }

  /**
   * Establish Copilot auth: reuse a valid OpenCode GitHub token when present,
   * otherwise run the device flow. On success the GitHub OAuth token is
   * persisted to the auth store. Idempotent — returns early if already connected
   * with a still-valid token.
   */
  async connect(callbacks: ConnectCallbacks = {}): Promise<void> {
    // Reuse OpenCode's token first: validate it by attempting a Copilot exchange.
    const opencodeToken = this.findOpencodeToken();
    if (opencodeToken && (await this.isGithubTokenValid(opencodeToken))) {
      this.persistGithubToken(opencodeToken);
      return;
    }

    // Fall back to the device flow.
    const device = await requestDeviceCode(this.config, { fetch: this.doFetch });
    callbacks.onUserCode?.(device);
    const githubToken = await pollForAccessToken(this.config, device, {
      fetch: this.doFetch,
      sleep: this.sleep,
    });
    this.persistGithubToken(githubToken);
  }

  /**
   * Return a valid Copilot bearer token, exchanging or refreshing as needed:
   * a cached token outside the refresh threshold is reused; one within the
   * threshold (or absent) triggers a fresh exchange. Throws
   * `GithubTokenRejectedError` when re-authentication is required, and a plain
   * error when no GitHub token is stored yet.
   */
  async ensureFreshToken(): Promise<string> {
    const state = this.current();
    if (!state?.githubToken) {
      throw new GithubTokenRejectedError(
        "no GitHub OAuth token stored — run /connect copilot to authenticate",
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const threshold = this.config.refreshThresholdSeconds;
    if (
      state.copilotToken &&
      state.copilotExpiresAt &&
      state.copilotExpiresAt - now > threshold
    ) {
      return state.copilotToken;
    }

    const fresh = await this.exchange(state.githubToken);
    this.store.setCopilotToken(state.accountId, fresh.token, fresh.expiresAt);
    return fresh.token;
  }

  private async exchange(githubToken: string): Promise<CopilotToken> {
    return exchangeForCopilotToken(githubToken, this.config, this.doFetch);
  }

  /** Validate a GitHub token by attempting an exchange; rejection => invalid. */
  private async isGithubTokenValid(githubToken: string): Promise<boolean> {
    try {
      await this.exchange(githubToken);
      return true;
    } catch (err) {
      if (err instanceof GithubTokenRejectedError) return false;
      throw err; // network/server error — surface, don't silently fall through
    }
  }

  private persistGithubToken(githubToken: string): void {
    const existing = this.current();
    this.store.set({
      accountId: this.accountId,
      githubToken,
      // Drop any cached bearer tied to a previous identity/token.
      copilotToken: existing?.githubToken === githubToken ? existing.copilotToken : undefined,
      copilotExpiresAt: existing?.githubToken === githubToken ? existing.copilotExpiresAt : undefined,
    });
  }
}
