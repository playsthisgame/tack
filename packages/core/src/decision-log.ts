import { Database } from "bun:sqlite";
import type { DecisionLog, PromptContext, RoutingDecision } from "./types";

/**
 * SQLite-backed `DecisionLog` using Bun's built-in driver (no dependency added).
 *
 * The schema is normalized into two tables — one row per decision plus one row
 * per fired signal — so later weight-calibration queries ("how often does
 * stack_trace fire and where does it route?") are natural SQL rather than JSON
 * digging. The whole point of logging is that analysis, so queryability wins
 * over the simplicity of a blob column.
 *
 * Schema creation is idempotent (`CREATE TABLE IF NOT EXISTS`): opening an
 * existing database reuses it without touching prior rows.
 */
export class SqliteDecisionLog implements DecisionLog {
  private readonly db: Database;

  /**
   * @param path Database file path. Use `":memory:"` for an ephemeral store
   *   (handy in tests). The caller is responsible for ensuring the parent
   *   directory exists for file paths.
   */
  constructor(path: string) {
    this.db = new Database(path);
    // WAL keeps reads from blocking the single writer; fine for local use.
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at  TEXT    NOT NULL,
        prompt      TEXT    NOT NULL,
        score       REAL    NOT NULL,
        tier        TEXT    NOT NULL,
        model       TEXT    NOT NULL,
        token_count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contributions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        decision_id INTEGER NOT NULL REFERENCES decisions(id),
        signal      TEXT    NOT NULL,
        detail      TEXT    NOT NULL,
        weight      REAL    NOT NULL
      );
    `);
  }

  record(context: PromptContext, decision: RoutingDecision, model: string): void {
    const insertDecision = this.db.query(
      `INSERT INTO decisions (created_at, prompt, score, tier, model, token_count)
       VALUES ($createdAt, $prompt, $score, $tier, $model, $tokenCount)
       RETURNING id`,
    );
    const insertContribution = this.db.query(
      `INSERT INTO contributions (decision_id, signal, detail, weight)
       VALUES ($decisionId, $signal, $detail, $weight)`,
    );

    // A decision and its contributions are written atomically.
    const writeAll = this.db.transaction(() => {
      const row = insertDecision.get({
        $createdAt: new Date().toISOString(),
        $prompt: context.prompt,
        $score: decision.score,
        $tier: decision.tier,
        $model: model,
        $tokenCount: decision.tokenCount,
      }) as { id: number };

      for (const c of decision.contributions) {
        insertContribution.run({
          $decisionId: row.id,
          $signal: c.signal,
          $detail: c.detail,
          $weight: c.weight,
        });
      }
    });

    writeAll();
  }

  /**
   * Recently logged prompts in chronological order (oldest → newest), with
   * back-to-back duplicates collapsed — the source for prompt-history navigation
   * in the TUI. Reads at most `limit` rows.
   */
  recentPrompts(limit = 200): string[] {
    const rows = this.db
      .query("SELECT prompt FROM decisions ORDER BY id DESC LIMIT $limit")
      .all({ $limit: limit }) as { prompt: string }[];

    // Query is newest-first; walk back to oldest-first, dropping consecutive repeats.
    const out: string[] = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const prompt = rows[i]!.prompt;
      if (out[out.length - 1] !== prompt) out.push(prompt);
    }
    return out;
  }

  close(): void {
    this.db.close();
  }
}
