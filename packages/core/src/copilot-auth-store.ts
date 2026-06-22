import { Database } from "bun:sqlite";

/**
 * Persisted Copilot auth state for one identity. Both tokens are SECRETS: the
 * long-lived GitHub OAuth token and the short-lived Copilot bearer. They live
 * in a dedicated store, never alongside routing logs, and never get serialized
 * into shared/inspectable output (see `CopilotAuthStore.redacted`).
 */
export interface CopilotAuthState {
  /** Identity key — one row per Copilot identity (multi-account is added rows). */
  accountId: string;
  /** Long-lived GitHub OAuth token (`gho_…`). Secret. */
  githubToken: string;
  /** Short-lived Copilot bearer token, if one has been exchanged yet. Secret. */
  copilotToken?: string;
  /** Unix epoch seconds at which `copilotToken` expires. */
  copilotExpiresAt?: number;
}

/** Read/write access to persisted Copilot auth state, keyed by account id. */
export interface CopilotAuthStore {
  get(accountId: string): CopilotAuthState | undefined;
  /** The single stored identity, when the caller does not track an account id. */
  first(): CopilotAuthState | undefined;
  set(state: CopilotAuthState): void;
  /** Update only the cached Copilot bearer + its expiry for an existing identity. */
  setCopilotToken(accountId: string, token: string, expiresAt: number): void;
}

/** The default account id used when Tack tracks a single Copilot identity. */
export const DEFAULT_COPILOT_ACCOUNT = "default";

/**
 * SQLite-backed Copilot auth store using Bun's built-in driver (no dependency
 * added), mirroring `SqliteDecisionLog`. Kept in a SEPARATE database file from
 * the routing log so secrets never share a store with shareable/inspectable
 * routing data. Schema creation is idempotent.
 */
export class SqliteCopilotAuthStore implements CopilotAuthStore {
  private readonly db: Database;

  /**
   * @param path Database file path. Use `":memory:"` for an ephemeral store
   *   (handy in tests). The caller ensures the parent directory exists.
   */
  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS copilot_auth (
        account_id         TEXT    PRIMARY KEY,
        github_token       TEXT    NOT NULL,
        copilot_token      TEXT,
        copilot_expires_at INTEGER
      );
    `);
  }

  private rowToState(row: AuthRow | undefined): CopilotAuthState | undefined {
    if (!row) return undefined;
    return {
      accountId: row.account_id,
      githubToken: row.github_token,
      copilotToken: row.copilot_token ?? undefined,
      copilotExpiresAt: row.copilot_expires_at ?? undefined,
    };
  }

  get(accountId: string): CopilotAuthState | undefined {
    const row = this.db
      .query("SELECT * FROM copilot_auth WHERE account_id = $id")
      .get({ $id: accountId }) as AuthRow | undefined;
    return this.rowToState(row);
  }

  first(): CopilotAuthState | undefined {
    const row = this.db
      .query("SELECT * FROM copilot_auth ORDER BY rowid LIMIT 1")
      .get() as AuthRow | undefined;
    return this.rowToState(row);
  }

  set(state: CopilotAuthState): void {
    this.db
      .query(
        `INSERT INTO copilot_auth (account_id, github_token, copilot_token, copilot_expires_at)
         VALUES ($id, $github, $copilot, $expires)
         ON CONFLICT(account_id) DO UPDATE SET
           github_token       = excluded.github_token,
           copilot_token      = excluded.copilot_token,
           copilot_expires_at = excluded.copilot_expires_at`,
      )
      .run({
        $id: state.accountId,
        $github: state.githubToken,
        $copilot: state.copilotToken ?? null,
        $expires: state.copilotExpiresAt ?? null,
      });
  }

  setCopilotToken(accountId: string, token: string, expiresAt: number): void {
    this.db
      .query(
        `UPDATE copilot_auth
         SET copilot_token = $copilot, copilot_expires_at = $expires
         WHERE account_id = $id`,
      )
      .run({ $id: accountId, $copilot: token, $expires: expiresAt });
  }

  close(): void {
    this.db.close();
  }
}

interface AuthRow {
  account_id: string;
  github_token: string;
  copilot_token: string | null;
  copilot_expires_at: number | null;
}

/**
 * A secret-free view of auth state, safe for logs or inspection output. The
 * tokens are reduced to booleans — the one place a caller turns auth state into
 * something renderable, so secrets cannot leak through status output.
 */
export function redactedAuthState(
  state: CopilotAuthState | undefined,
): { accountId: string; hasGithubToken: boolean; hasCopilotToken: boolean } | undefined {
  if (!state) return undefined;
  return {
    accountId: state.accountId,
    hasGithubToken: Boolean(state.githubToken),
    hasCopilotToken: Boolean(state.copilotToken),
  };
}
