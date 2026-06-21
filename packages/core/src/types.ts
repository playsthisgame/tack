/**
 * Core types for Tack's routing engine.
 *
 * The central abstraction is the `Scorer` interface. Today it is implemented by
 * a transparent keyword/heuristic scorer; later it can be implemented by an
 * embedding-based classifier WITHOUT any caller needing to change. Everything
 * downstream depends on `RoutingDecision`, not on how the score was produced.
 */

export type Tier = "cheap" | "mid" | "frontier";

/** A single message in the prompt context being scored. */
export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Everything Tack can see about a request before dispatching it. In Phase 1
 * (Tack as client) we own all of this. The scorer reads from it; it never
 * mutates it.
 */
export interface PromptContext {
  /** The newest user message — the thing actually being routed. */
  prompt: string;
  /** Prior turns, oldest first. Empty for a fresh conversation. */
  history: PromptMessage[];
  /** Optional system prompt, counted toward size but weighted lightly. */
  system?: string;
}

/**
 * One signal that fired during scoring, with how much it contributed. Recording
 * these is a first-class requirement: it is what makes routing inspectable.
 */
export interface SignalContribution {
  /** Stable identifier, e.g. "token_count", "stack_trace", "keyword:refactor". */
  signal: string;
  /** Human-readable reason, e.g. "large prompt (3200 tokens)". */
  detail: string;
  /** Signed contribution to the total score. */
  weight: number;
}

/**
 * One labeled training example: a prompt a human assigned to a tier. The labeled
 * set IS the k-NN scorer's "model" — editing it is how the scorer is trained.
 * `source` is an extensible union; only `seed` (shipped) and `user` (the operator's
 * own labels) exist today, with room for e.g. `"harvested"` later.
 */
export interface LabeledExample {
  /** Stable identifier, unique within its source. */
  id: string;
  /** The example prompt text. */
  prompt: string;
  /** The tier a human assigned to this prompt. */
  tier: Tier;
  /** Where the label came from. User labels win over seed labels on conflict. */
  source: "seed" | "user";
}

/**
 * A `LabeledExample` with its computed embedding. The vector is always tagged with
 * the `model` that produced it so the loader can refuse to compare vectors across
 * embedding models (an apples-to-oranges distance is worse than recomputing).
 */
export interface EmbeddedExample extends LabeledExample {
  /** The example's embedding under `model`. */
  embedding: Float32Array;
  /** The embedding model that produced `embedding`. */
  model: string;
}

/**
 * The on-disk seed file format. Carries the embedding `model`/`dimension` it was
 * authored against (for the loader's model guard), a `version`, and the authored
 * examples. Examples carry no vectors — those are always derived, never authored.
 */
export interface SeedFile {
  model: string;
  dimension: number;
  version: number;
  examples: LabeledExample[];
}

/**
 * A nearest labeled example surfaced by the k-NN scorer, for inspection. The
 * explanation IS the mechanism: a decision reports the actual nearest prompts and
 * their distances, not an opaque score.
 */
export interface Neighbor {
  id: string;
  prompt: string;
  tier: Tier;
  /** Cosine distance from the scored prompt (0 = identical, larger = farther). */
  distance: number;
}

/**
 * Local embedding provider. `embed` maps text to a vector; `model` and `dimension`
 * tag every vector it produces so cross-model comparisons can be refused. The
 * initial implementation runs on-device; a hosted backend is a future swap behind
 * this same interface.
 */
export interface Embedder {
  /** The model identifier, e.g. "Xenova/all-MiniLM-L6-v2". */
  readonly model: string;
  /** The output vector length, e.g. 384. */
  readonly dimension: number;
  /** Embed `text` into a `dimension`-length vector. */
  embed(text: string): Promise<Float32Array>;
}

/** The full, inspectable result of scoring one prompt. */
export interface RoutingDecision {
  /** The tier actually chosen, after the context-window feasibility check. */
  tier: Tier;
  /**
   * The tier complexity alone preferred, before feasibility. Equals `tier`
   * unless a context-driven escalation occurred.
   */
  preferredTier: Tier;
  /**
   * True when `tier` was raised above `preferredTier` solely because the
   * context did not fit the preferred tier's model window. A complexity-driven
   * tier is NOT an escalation.
   */
  escalated: boolean;
  /**
   * True when the measured context exceeds every tier's window (minus
   * headroom). `tier` is then the largest-window tier and dispatch should be
   * blocked pending compaction.
   */
  exceedsAllWindows: boolean;
  score: number;
  /** Every signal that fired, for display and for logging. */
  contributions: SignalContribution[];
  /** Token count measured for this context (approximate for non-OpenAI models). */
  tokenCount: number;
  /**
   * How sure the scorer is of `tier`, in [0, 1]. For the k-NN scorer this is
   * derived from the weighted-vote margin and the nearest-neighbor distances; for
   * the heuristic scorer it is derived from its own signal strength. Both scorers
   * populate it so the field is part of one shared contract.
   */
  confidence: number;
  /**
   * The nearest labeled examples that drove a k-NN decision, top-`k` by distance.
   * Empty for the heuristic scorer (which has no neighbors).
   */
  neighbors: Neighbor[];
  /**
   * True when the scorer could not decide confidently — the nearest neighbors were
   * all farther than `distanceThreshold`, the weighted vote margin was below
   * `marginThreshold`, or the labeled set was empty. When set, the configured
   * uncertainty policy (escalate/fallback) was applied; see `contributions`.
   */
  uncertain?: boolean;
}

/**
 * Accumulated, per-session view of context-driven escalations. Complexity-driven
 * routing is deliberately excluded — only escalations caused by context size are
 * counted, because only those are addressable by compacting the conversation.
 */
export interface SessionStats {
  /** Count of prompts whose preferred tier was overridden solely by context size. */
  costEscalations: number;
  /** Estimated extra spend (USD) those escalations incurred this session. */
  estimatedExtraCost: number;
}

/**
 * A passive, advisory-only signal surfaced to the user. Tack never acts on these
 * itself — compaction (even in the blocking case) is always the user's call.
 */
export type Advisory =
  | {
      /** Cost-saving hint: compacting would let prompts route to a cheaper tier. */
      kind: "compaction-savings";
      escalations: number;
      estimatedSaving: number;
      message: string;
    }
  | {
      /** Blocking: no model can hold the context; compaction is required first. */
      kind: "compaction-required";
      tokenCount: number;
      largestWindow: number;
      message: string;
    };

/**
 * The swap point. v1 = keyword heuristics. v2 = embedding centroids.
 * Implementations must be synchronous-friendly but may be async to allow a
 * future embedding model; callers should await.
 */
export interface Scorer {
  score(context: PromptContext): Promise<RoutingDecision>;
}

/** Counts tokens for a piece of text. Abstracted so the tokenizer can be swapped. */
export interface Tokenizer {
  count(text: string): number;
}

/**
 * The persistence swap point. Logging is deliberately kept OUT of the scoring
 * path: `Scorer` stays pure and I/O-free, and callers wire a `DecisionLog` in
 * separately. v1 is a `bun:sqlite` implementation; a different backend can be
 * substituted without changing any caller, exactly like `Scorer`/`Tokenizer`.
 */
export interface DecisionLog {
  /**
   * Persist one routing decision and its full signal breakdown. `model` is the
   * concrete model resolved for `decision.tier`; it is passed in because the
   * tier→model mapping is a config concern the scorer does not carry on the
   * decision itself.
   */
  record(context: PromptContext, decision: RoutingDecision, model: string): void;
  /** Release the underlying handle. */
  close(): void;
}

/**
 * Typed events emitted by the agentic dispatch loop. Consumers (CLI, TUI)
 * depend only on this union — nothing provider- or SDK-specific leaks out.
 */
export type AgentEvent =
  | { type: "dispatching" }
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; id: string; toolName: string; args: unknown }
  | { type: "tool-result"; id: string; toolName: string; result: string }
  | { type: "routing"; step: number; decision: RoutingDecision; model: string }
  | { type: "advisory"; advisory: Advisory }
  | { type: "error"; message: string }
  | { type: "done" };

/**
 * The delivery swap point: turns a context into an async stream of agent
 * events. Like `Scorer`/`Tokenizer`/`DecisionLog`, the interface lives in
 * `core` as pure types so the scoring engine stays provider-free.
 */
export interface Dispatcher {
  dispatch(context: PromptContext): AsyncIterable<AgentEvent>;
}
