import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApproxTokenizer,
  defaultConfig,
  HeuristicScorer,
  SqliteDecisionLog,
  type PromptContext,
  type RoutingDecision,
} from "../src/index";

const scorer = new HeuristicScorer(defaultConfig, new ApproxTokenizer());

function ctx(prompt: string): PromptContext {
  return { prompt, history: [] };
}

async function scoreAndLog(
  log: SqliteDecisionLog,
  prompt: string,
): Promise<{ decision: RoutingDecision; model: string }> {
  const decision = await scorer.score(ctx(prompt));
  const model = defaultConfig.tierModels[decision.tier];
  log.record(ctx(prompt), decision, model);
  return { decision, model };
}

describe("SqliteDecisionLog", () => {
  let log: SqliteDecisionLog;

  beforeEach(() => {
    log = new SqliteDecisionLog(":memory:");
  });

  afterEach(() => {
    log.close();
  });

  test("persists a decision with score, tier, model, and token count", async () => {
    const { decision, model } = await scoreAndLog(log, "refactor the auth module");

    // Read back through the same in-memory handle.
    const db = (log as unknown as { db: Database }).db;
    const row = db
      .query(
        "SELECT prompt, score, tier, model, token_count FROM decisions",
      )
      .get() as {
      prompt: string;
      score: number;
      tier: string;
      model: string;
      token_count: number;
    };

    expect(row.prompt).toBe("refactor the auth module");
    expect(row.score).toBe(decision.score);
    expect(row.tier).toBe(decision.tier);
    expect(row.model).toBe(model);
    expect(row.token_count).toBe(decision.tokenCount);
  });

  test("all signal contributions round-trip", async () => {
    const { decision } = await scoreAndLog(log, "refactor this typo");
    expect(decision.contributions.length).toBeGreaterThan(0);

    const db = (log as unknown as { db: Database }).db;
    const rows = db
      .query(
        `SELECT signal, detail, weight FROM contributions
         JOIN decisions ON contributions.decision_id = decisions.id
         ORDER BY contributions.id`,
      )
      .all() as { signal: string; detail: string; weight: number }[];

    expect(rows.length).toBe(decision.contributions.length);
    for (const c of decision.contributions) {
      expect(
        rows.some(
          (r) => r.signal === c.signal && r.detail === c.detail && r.weight === c.weight,
        ),
      ).toBe(true);
    }
  });

  test("records a baseline decision with no contributions and score zero", async () => {
    const { decision } = await scoreAndLog(log, "hello");
    expect(decision.contributions.length).toBe(0);
    expect(decision.score).toBe(0);

    const db = (log as unknown as { db: Database }).db;
    const decisionCount = (
      db.query("SELECT COUNT(*) AS n FROM decisions").get() as { n: number }
    ).n;
    const contribCount = (
      db.query("SELECT COUNT(*) AS n FROM contributions").get() as { n: number }
    ).n;

    expect(decisionCount).toBe(1);
    expect(contribCount).toBe(0);
  });
});

describe("SqliteDecisionLog idempotent init", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tack-test-"));
    dbPath = join(dir, "tack.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("reopening an existing database preserves prior rows", async () => {
    const first = new SqliteDecisionLog(dbPath);
    await scoreAndLog(first, "refactor the architecture");
    first.close();

    // Reopen — init must not drop the existing row.
    const second = new SqliteDecisionLog(dbPath);
    const db = (second as unknown as { db: Database }).db;
    const count = (
      db.query("SELECT COUNT(*) AS n FROM decisions").get() as { n: number }
    ).n;
    expect(count).toBe(1);

    await scoreAndLog(second, "rename a variable");
    const after = (
      db.query("SELECT COUNT(*) AS n FROM decisions").get() as { n: number }
    ).n;
    expect(after).toBe(2);
    second.close();
  });
});

describe("logging does not affect scoring", () => {
  test("decision is identical with and without logging", async () => {
    const prompt = "Help me architect and design a refactor of this module";

    const withoutLog = await scorer.score(ctx(prompt));

    const log = new SqliteDecisionLog(":memory:");
    const withLog = await scorer.score(ctx(prompt));
    log.record(ctx(prompt), withLog, defaultConfig.tierModels[withLog.tier]);
    log.close();

    expect(withLog).toEqual(withoutLog);
  });
});
