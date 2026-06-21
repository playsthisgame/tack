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

/** The full, inspectable result of scoring one prompt. */
export interface RoutingDecision {
  tier: Tier;
  score: number;
  /** Every signal that fired, for display and for logging. */
  contributions: SignalContribution[];
  /** Token count measured for this context (approximate for non-OpenAI models). */
  tokenCount: number;
}

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
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; id: string; toolName: string; args: unknown }
  | { type: "tool-result"; id: string; toolName: string; result: string }
  | { type: "routing"; step: number; decision: RoutingDecision; model: string }
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
