#!/usr/bin/env bun
import { dirname } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import {
  BpeTokenizer,
  buildScorer,
  defaultConfig,
  simulateRoute,
  SqliteDecisionLog,
  SqliteLabeledExampleStore,
  type PromptContext,
  type RoutingDecision,
  type Scorer,
  type ScoringConfig,
  type Tier,
} from "@tack/core";
import {
  AiSdkDispatcher,
  buildSystemPrompt,
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

function resolveDbPath(explicit?: string): string {
  return explicit ?? process.env.TACK_DB_PATH ?? DEFAULT_DB_PATH;
}

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

function tierLine(d: RoutingDecision): string {
  if (d.exceedsAllWindows) {
    return `${d.tier} (preferred ${d.preferredTier}, exceeds all windows)`;
  }
  if (d.escalated) {
    return `${d.tier} (preferred ${d.preferredTier}, escalated for context size)`;
  }
  return d.tier;
}

function printDecision(d: RoutingDecision, model: string): void {
  console.log(`\ntier:    ${tierLine(d)}`);
  console.log(`model:   ${model}`);
  console.log(`score:   ${d.score}`);
  console.log(`conf:    ${d.confidence.toFixed(3)}${d.uncertain ? " (uncertain)" : ""}`);
  console.log(`tokens:  ${d.tokenCount}`);
  console.log(`why:`);
  if (d.contributions.length === 0) {
    console.log(`  (no signals fired — baseline cheap)`);
  }
  for (const c of d.contributions) {
    const sign = c.weight >= 0 ? "+" : "";
    console.log(`  ${sign}${c.weight}  ${c.detail}`);
  }
  // k-NN decisions surface their nearest labeled prompts and distances — the
  // explanation IS the mechanism.
  if (d.neighbors.length > 0) {
    console.log(`neighbors:`);
    for (const n of d.neighbors) {
      const text = n.prompt.replace(/\s+/g, " ").trim();
      const preview = text.length > 56 ? `${text.slice(0, 55)}…` : text;
      console.log(`  ${n.distance.toFixed(3)}  ${n.tier.padEnd(8)} "${preview}"`);
    }
  }
  console.log();
}

/**
 * Build the scorer the config selects, supplying the k-NN scorer the user's
 * labeled-example store (seeds + the user's own labels from the log DB).
 */
async function resolveScorer(config: ScoringConfig): Promise<Scorer> {
  if (config.scorer !== "knn") return buildScorer(config, { tokenizer: new BpeTokenizer() });
  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = new SqliteLabeledExampleStore(dbPath);
  return buildScorer(config, { tokenizer: new BpeTokenizer(), store });
}

async function cmdScore(prompt: string, log: boolean, scorerKind?: ScoringConfig["scorer"]): Promise<void> {
  const config: ScoringConfig = scorerKind ? { ...defaultConfig, scorer: scorerKind } : defaultConfig;
  const scorer = await resolveScorer(config);
  const context: PromptContext = { prompt, history: [] };
  const d = await scorer.score(context);
  const model = config.tierModels[d.tier];

  printDecision(d, model);
  logDecision(context, d, model, log);
}

async function cmdDispatch(prompt: string, log: boolean): Promise<void> {
  const context: PromptContext = { prompt, history: [] };
  const dispatcher = new AiSdkDispatcher();

  let firstStep = true;
  let blocked = false;

  try {
    for await (const event of dispatcher.dispatch(context)) {
      switch (event.type) {
        case "advisory":
          if (event.advisory.kind === "compaction-required") {
            blocked = true;
            process.stderr.write(`\n[blocked] ${event.advisory.message}\n`);
          } else {
            process.stderr.write(`\n[advisory] ${event.advisory.message}\n`);
          }
          break;
        case "routing":
          if (firstStep) {
            printDecision(event.decision, event.model);
            logDecision(context, event.decision, event.model, log);
            firstStep = false;
          } else {
            process.stderr.write(
              `[step ${event.step}] ${event.decision.tier} · ${event.model} (score ${event.decision.score})\n`,
            );
          }
          break;
        case "text-delta":
          process.stdout.write(event.delta);
          break;
        case "tool-call":
          process.stderr.write(
            `[tool] ${event.toolName}(${JSON.stringify(event.args).slice(0, 120)})\n`,
          );
          break;
        case "tool-result":
          process.stderr.write(
            `[result] ${event.toolName}: ${String(event.result).slice(0, 120).replace(/\n/g, "↵")}\n`,
          );
          break;
        case "error":
          console.error(`error: ${event.message}`);
          process.exit(1);
          break;
        case "done":
          process.stdout.write("\n");
          if (blocked) process.exit(1);
          break;
      }
    }
  } catch (err) {
    if (err instanceof MissingApiKeyError || err instanceof UnknownProviderError) {
      console.error(`error: ${err.message}`);
    } else {
      console.error(`error: dispatch failed: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

// A demo preset for `route`: the cheap window is so small that any real phrase
// (≥2 tokens) escalates past it, mid holds short prompts, and a ~80+ token block
// exceeds every window — so escalation, the advisory, and the blocking case are all
// reachable with normal hand-typed prompts.
const TINY_WINDOWS: Record<Tier, number> = { cheap: 1, mid: 40, frontier: 80 };
const TINY_HEADROOM = 0;

interface RouteWindows {
  tierWindows: Record<Tier, number>;
  responseHeadroom: number;
}

/**
 * Resolve a `--windows` spec into per-tier window sizes AND a coherent response
 * headroom. Accepts the `tiny` preset (small windows so escalation triggers on
 * short inputs) or an explicit `cheap=..,mid=..,frontier=..` list; tiers omitted
 * from a list keep the default. The headroom is clamped below the smallest window
 * so feasibility stays meaningful (the default 8000 would otherwise sink tiny
 * windows negative and block every prompt). An explicit `headroom` wins.
 */
function parseWindows(
  spec: string | undefined,
  base: RouteWindows,
  headroomOverride: number | undefined,
): RouteWindows {
  let tierWindows = base.tierWindows;
  let responseHeadroom = base.responseHeadroom;

  if (spec === "tiny") {
    tierWindows = { ...TINY_WINDOWS };
    responseHeadroom = TINY_HEADROOM;
  } else if (spec) {
    tierWindows = { ...base.tierWindows };
    for (const pair of spec.split(",")) {
      const [tier, value] = pair.split("=");
      const n = Number(value);
      if ((tier === "cheap" || tier === "mid" || tier === "frontier") && Number.isFinite(n)) {
        tierWindows[tier] = n;
      } else {
        console.error(`error: invalid --windows entry "${pair}" (expected tier=number)`);
        process.exit(1);
      }
    }
    // Keep headroom below the smallest window so a non-empty context can fit.
    const smallest = Math.min(...Object.values(tierWindows));
    responseHeadroom = Math.min(responseHeadroom, Math.floor(smallest / 2));
  }

  if (headroomOverride !== undefined) responseHeadroom = headroomOverride;
  return { tierWindows, responseHeadroom };
}

/** Collect prompts for `route`: positional args, a `--file`, or stdin (one per line). */
function routePrompts(positional: string[], file: string | undefined): string[] {
  if (positional.length > 0) return positional;
  const raw = file ? readFileSync(file, "utf8") : readStdinSync();
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

async function cmdRoute(args: string[]): Promise<void> {
  // Parse flags; everything else is a literal prompt.
  let windowsSpec: string | undefined;
  let headroomOverride: number | undefined;
  let file: string | undefined;
  let accumulate = false;
  let why = false;
  let withContext = false;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--windows") windowsSpec = args[++i];
    else if (a === "--headroom") headroomOverride = Number(args[++i]);
    else if (a === "--file") file = args[++i];
    else if (a === "--accumulate") accumulate = true;
    else if (a === "--why" || a === "-v") why = true;
    else if (a === "--context") withContext = true;
    else positional.push(a);
  }

  const prompts = routePrompts(positional, file);
  if (prompts.length === 0) {
    console.error("error: no prompts provided (pass them as arguments, --file, or stdin)");
    process.exit(1);
  }

  const { tierWindows, responseHeadroom } = parseWindows(
    windowsSpec,
    { tierWindows: defaultConfig.tierWindows, responseHeadroom: defaultConfig.responseHeadroom },
    headroomOverride,
  );
  const config: ScoringConfig = { ...defaultConfig, tierWindows, responseHeadroom };

  // Optionally inject the same environment system prompt real dispatch sends
  // (cwd, file tree, git context) so the simulated token count and routing match.
  let system: string | undefined;
  if (withContext) {
    system = await buildSystemPrompt();
    const tokens = new BpeTokenizer().count(system);
    console.log(`context: injecting environment system prompt (${tokens} tokens — cwd, file tree, git)\n`);
  }

  // Pure simulation — no dispatch, no network, no API key, no logging.
  const { turns, stats } = await simulateRoute(prompts, config, { accumulate, system });

  turns.forEach((turn, i) => {
    const d = turn.decision;
    const tag = d.exceedsAllWindows ? "exceeds all windows" : d.escalated ? "escalated" : "—";
    const route = d.preferredTier === d.tier ? d.tier : `${d.preferredTier}→${d.tier}`;
    console.log(
      `[${i + 1}] ${route.padEnd(16)} ${tag.padEnd(20)} (score ${d.score}, context ${d.tokenCount} tokens)`,
    );
    if (why) {
      // The signal breakdown that drove the complexity score → preferred tier.
      // Context-driven escalations (if any) appear here too as weight-0 entries.
      if (d.contributions.length === 0) {
        console.log(`        why: (no signals fired — baseline cheap)`);
      } else {
        for (const c of d.contributions) {
          const sign = c.weight >= 0 ? "+" : "";
          console.log(`        ${sign}${c.weight}  ${c.detail}`);
        }
      }
    }
    if (turn.advisory) {
      const label = turn.advisory.kind === "compaction-required" ? "BLOCKED" : "ADVISORY";
      console.log(`      ${label}: ${turn.advisory.message}`);
    }
  });

  console.log(
    `\nsession: ${stats.costEscalations} context-driven escalation(s), ` +
      `est. extra cost ~$${stats.estimatedExtraCost.toFixed(4)}`,
  );
}

function usage(): void {
  console.log(`tack — heuristic prompt router (POC)

usage:
  tack                       launch the interactive TUI (default)
  tack score "<prompt>"      score a prompt and show the routing decision
  echo "<prompt>" | tack score
  tack dispatch "<prompt>"   score, then call the routed model and stream output
  tack route "<p1>" "<p2>"   simulate routing for a sequence of prompts without
                             dispatching (no tokens, no API key) — shows tier
                             escalations and the compaction advisory

options:
  --no-log                   do not persist the decision to the SQLite log (score/dispatch)
  --scorer <kind>            score: pick the scorer — "heuristic" (default) or "knn"
                             (semantic k-NN over the labeled set; loads a local model)
  --why, -v                  route: show the signal breakdown behind each decision
  --context                  route: inject the real environment system prompt (cwd,
                             file tree, git) so token counts match what dispatch sends
  --windows <spec>           route: override tier context windows. "tiny" for a small
                             preset, or "cheap=50,mid=500,frontier=1000"
  --headroom <n>             route: response-headroom reserve (tokens) subtracted from
                             each window when testing feasibility
  --file <path>              route: read newline-separated prompts from a file
  --accumulate               route: grow conversation history each turn so context size
                             rises turn-over-turn

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
  | { kind: "route"; args: string[] }
  | { kind: "unknown"; cmd: string };

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
    case "route":
      return { kind: "route", args: rest };
    default:
      return { kind: "unknown", cmd };
  }
}

async function runScoreOrDispatch(kind: "score" | "dispatch", args: string[]): Promise<void> {
  const log = !args.includes("--no-log");

  // Pull out `--scorer <heuristic|knn>` (score only); everything else is the prompt.
  let scorerKind: ScoringConfig["scorer"] | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--no-log") continue;
    if (a === "--scorer") {
      const v = args[++i];
      if (v !== "heuristic" && v !== "knn") {
        console.error(`error: --scorer must be "heuristic" or "knn"`);
        process.exit(1);
      }
      scorerKind = v;
      continue;
    }
    rest.push(a);
  }

  const prompt = rest.join(" ").trim() || readStdinSync().trim();
  if (!prompt) {
    console.error("error: no prompt provided");
    process.exit(1);
  }
  if (kind === "score") {
    await cmdScore(prompt, log, scorerKind);
  } else {
    await cmdDispatch(prompt, log);
  }
}

if (import.meta.main) {
  const command = parseCommand(process.argv.slice(2));
  switch (command.kind) {
    case "tui": {
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
    case "route":
      await cmdRoute(command.args);
      break;
    case "unknown":
      console.error(`unknown command: ${command.cmd}`);
      usage();
      process.exit(1);
  }
}
