import type { ScoringConfig } from "./config";
import { buildScorer } from "./build-scorer";
import { SessionTracker } from "./session";
import type { LabeledExampleStore } from "./labeled-store";
import type { Advisory, PromptMessage, RoutingDecision, Scorer, SessionStats, Tokenizer } from "./types";

/** One simulated turn: the routing decision, any advisory it raised, and whether
 * a real dispatch would have proceeded (false when the context exceeds all windows). */
export interface RouteTurn {
  prompt: string;
  decision: RoutingDecision;
  advisory: Advisory | null;
  dispatched: boolean;
}

/** The full result of a simulation: every turn plus the final session counters. */
export interface RouteSimulation {
  turns: RouteTurn[];
  stats: SessionStats;
}

export interface SimulateRouteOptions {
  /** Tokenizer to measure context size. Defaults to `BpeTokenizer` (as in real routing). */
  tokenizer?: Tokenizer;
  /**
   * When true, each prompt is appended to a growing history so the measured token
   * count rises turn-over-turn — useful for demonstrating escalation with realistic
   * window sizes rather than the tiny test preset.
   */
  accumulate?: boolean;
  /**
   * System prompt counted into every turn's context, matching what real dispatch
   * injects (cwd, file tree, git context). Supplying it makes the simulated token
   * count and routing faithful to `tack dispatch`. Left empty, the simulation
   * scores prompt + history only.
   */
  system?: string;
  /**
   * Scorer to simulate with. Defaults to the one `config.scorer` selects (built via
   * `buildScorer`). Pass an explicit scorer to pin behavior — e.g. tests that want
   * the heuristic without loading the embedding model.
   */
  scorer?: Scorer;
  /** User labeled-example store for the k-NN scorer. Seed-only when omitted. */
  store?: LabeledExampleStore;
}

/**
 * Run a sequence of prompts through the real scorer and a single `SessionTracker`,
 * producing the routing decision and any advisory for each — WITHOUT dispatching to
 * any model. This mirrors the per-turn routing logic in `AgentLoop.run` (score,
 * block on overflow, otherwise record the escalation) so the entire context-aware
 * routing and advisory matrix can be exercised with zero token spend and no API key.
 */
export async function simulateRoute(
  prompts: string[],
  config: ScoringConfig,
  opts: SimulateRouteOptions = {},
): Promise<RouteSimulation> {
  const scorer =
    opts.scorer ?? (await buildScorer(config, { tokenizer: opts.tokenizer, store: opts.store }));
  const tracker = new SessionTracker(config);
  const history: PromptMessage[] = [];
  const turns: RouteTurn[] = [];

  for (const prompt of prompts) {
    const decision = await scorer.score({ prompt, history: [...history], system: opts.system });

    if (decision.exceedsAllWindows) {
      // Mirror dispatch: a blocked turn surfaces the advisory and sends nothing.
      // It is not added to history — a real session would compact before retrying.
      turns.push({ prompt, decision, advisory: tracker.blockingAdvisory(decision), dispatched: false });
      continue;
    }

    const advisory = tracker.record(decision);
    turns.push({ prompt, decision, advisory, dispatched: true });

    if (opts.accumulate) {
      history.push({ role: "user", content: prompt });
      // A placeholder assistant turn keeps the shape realistic; its content is
      // empty because the simulator never calls a model.
      history.push({ role: "assistant", content: "" });
    }
  }

  return { turns, stats: tracker.stats };
}
