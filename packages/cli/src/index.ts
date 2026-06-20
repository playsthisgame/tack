#!/usr/bin/env bun
/**
 * Tack CLI — Phase 1 entry point.
 *
 * For the POC the most valuable command is `score`: it runs the heuristic
 * scorer against a prompt and prints the routing decision WITH the full signal
 * breakdown. This needs no API keys and is how you sanity-check routing while
 * tuning weights. Dispatch (actually calling a model) comes in a later change.
 */
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import {
  BpeTokenizer,
  defaultConfig,
  HeuristicScorer,
  SqliteDecisionLog,
  type PromptContext,
  type RoutingDecision,
} from "@tack/core";
import {
  AiSdkDispatcher,
  MissingApiKeyError,
  UnknownProviderError,
} from "@tack/dispatch";

const DEFAULT_DB_PATH = "./.tack/tack.db";

function readStdinSync(): string {
  try {
    return require("fs").readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Resolve the log database path: explicit arg → TACK_DB_PATH env → default. */
function resolveDbPath(explicit?: string): string {
  return explicit ?? process.env.TACK_DB_PATH ?? DEFAULT_DB_PATH;
}

/**
 * Best-effort decision logging shared by `score` and `dispatch`. A bad DB path
 * must never swallow or block the decision the user already saw.
 */
function logDecision(
  context: PromptContext,
  decision: RoutingDecision,
  model: string,
  enabled: boolean,
): void {
  if (!enabled) return;
  try {
    const dbPath = resolveDbPath();
    mkdirSync(dirname(dbPath), { recursive: true });
    const decisionLog = new SqliteDecisionLog(dbPath);
    decisionLog.record(context, decision, model);
    decisionLog.close();
  } catch (err) {
    console.error(`warning: failed to log decision: ${(err as Error).message}`);
  }
}

/** Print the routing decision header — the inspectable "why" before any output. */
function printDecision(d: RoutingDecision, model: string): void {
  console.log(`\ntier:    ${d.tier}`);
  console.log(`model:   ${model}`);
  console.log(`score:   ${d.score}`);
  console.log(`tokens:  ${d.tokenCount}`);
  console.log(`why:`);
  if (d.contributions.length === 0) {
    console.log(`  (no signals fired — baseline cheap)`);
  }
  for (const c of d.contributions) {
    const sign = c.weight >= 0 ? "+" : "";
    console.log(`  ${sign}${c.weight}  ${c.detail}`);
  }
  console.log();
}

async function cmdScore(prompt: string, log: boolean): Promise<void> {
  const scorer = new HeuristicScorer(defaultConfig, new BpeTokenizer());
  const context: PromptContext = { prompt, history: [] };
  const d = await scorer.score(context);
  const model = defaultConfig.tierModels[d.tier];

  printDecision(d, model);
  logDecision(context, d, model, log);
}

async function cmdDispatch(prompt: string, log: boolean): Promise<void> {
  const scorer = new HeuristicScorer(defaultConfig, new BpeTokenizer());
  const context: PromptContext = { prompt, history: [] };
  const d = await scorer.score(context);
  const model = defaultConfig.tierModels[d.tier];

  // Show why (and which model, i.e. which cost tier) before streaming output.
  printDecision(d, model);
  logDecision(context, d, model, log);

  const dispatcher = new AiSdkDispatcher();
  try {
    const { textStream } = await dispatcher.dispatch(model, context);
    for await (const chunk of textStream) {
      process.stdout.write(chunk);
    }
    process.stdout.write("\n");
  } catch (err) {
    if (err instanceof MissingApiKeyError || err instanceof UnknownProviderError) {
      console.error(`error: ${err.message}`);
    } else {
      console.error(`error: dispatch failed: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

function usage(): void {
  console.log(`tack — heuristic prompt router (POC)

usage:
  tack                       launch the interactive TUI (default)
  tack score "<prompt>"      score a prompt and show the routing decision
  echo "<prompt>" | tack score
  tack dispatch "<prompt>"   score, then call the routed model and stream output

options:
  --no-log                   do not persist the decision to the SQLite log

env:
  TACK_DB_PATH               override the log database path
                             (default: ${DEFAULT_DB_PATH})
  <PROVIDER>_API_KEY         dispatch requires the routed model's provider key
                             (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY,
                             GOOGLE_GENERATIVE_AI_API_KEY)
`);
}

export type Command =
  | { kind: "tui" }
  | { kind: "help" }
  | { kind: "score" | "dispatch"; args: string[] }
  | { kind: "unknown"; cmd: string };

/**
 * Pure routing: map argv (without the node/script prefix) to a command. No
 * subcommand means launch the TUI; this is what makes bare `tack` interactive.
 * Kept side-effect-free so it can be tested without executing anything.
 */
export function parseCommand(argv: string[]): Command {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
      return { kind: "tui" };
    case "-h":
    case "--help":
      return { kind: "help" };
    case "score":
    case "dispatch":
      return { kind: cmd, args: rest };
    default:
      return { kind: "unknown", cmd };
  }
}

async function runScoreOrDispatch(kind: "score" | "dispatch", args: string[]): Promise<void> {
  const log = !args.includes("--no-log");
  const prompt = args.filter((a) => a !== "--no-log").join(" ").trim() || readStdinSync().trim();
  if (!prompt) {
    console.error("error: no prompt provided");
    process.exit(1);
  }
  if (kind === "score") {
    await cmdScore(prompt, log);
  } else {
    await cmdDispatch(prompt, log);
  }
}

// Only execute when run as the `tack` entry point — importing this module (e.g.
// from tests for `parseCommand`) must not trigger a command.
if (import.meta.main) {
  const command = parseCommand(process.argv.slice(2));
  switch (command.kind) {
    case "tui": {
      // Imported lazily so `score`/`dispatch` never load Ink/React.
      const { runTui } = await import("@tack/tui");
      runTui();
      break;
    }
    case "help":
      usage();
      break;
    case "score":
    case "dispatch":
      await runScoreOrDispatch(command.kind, command.args);
      break;
    case "unknown":
      console.error(`unknown command: ${command.cmd}`);
      usage();
      process.exit(1);
  }
}
