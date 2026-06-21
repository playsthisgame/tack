import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { streamText as defaultStreamText } from "ai";
import {
  buildScorer,
  defaultConfig,
  SqliteLabeledExampleStore,
  type AgentEvent,
  type Dispatcher,
  type LabeledExampleStore,
  type PromptContext,
  type Scorer,
  type ScoringConfig,
} from "@tack/core";
import { defaultRegistry, type ProviderRegistry } from "./providers";
import { defaultToolRegistry, type ToolRegistry } from "./tools";
import { AgentLoop } from "./agent-loop";
import { buildSystemPrompt } from "./context";

type StreamText = typeof defaultStreamText;

const DEFAULT_DB_PATH = "./.tack/tack.db";

export interface AiSdkDispatcherOptions {
  registry?: ProviderRegistry;
  env?: Record<string, string | undefined>;
  tools?: ToolRegistry;
  /** Explicit scorer. When omitted, one is built lazily from `config.scorer`. */
  scorer?: Scorer;
  config?: ScoringConfig;
  streamText?: StreamText;
  maxSteps?: number;
  /** User labeled-example store for the k-NN scorer. Built from `dbPath` when omitted. */
  store?: LabeledExampleStore;
  /** Log-DB path the k-NN store reads user labels from. Defaults to `TACK_DB_PATH` or `./.tack/tack.db`. */
  dbPath?: string;
}

export class AiSdkDispatcher implements Dispatcher {
  private readonly options: AiSdkDispatcherOptions;
  // The agent loop is built once (the k-NN model + labeled set load on first use)
  // and reused across turns so the session tracker accumulates over a conversation.
  private loop: Promise<AgentLoop> | null = null;

  constructor(options: AiSdkDispatcherOptions = {}) {
    this.options = options;
  }

  private buildLoop(): Promise<AgentLoop> {
    if (this.loop === null) {
      this.loop = (async () => {
        const config = this.options.config ?? defaultConfig;
        const scorer = this.options.scorer ?? (await this.resolveScorer(config));
        return new AgentLoop({
          scorer,
          config,
          registry: this.options.registry,
          tools: this.options.tools ?? defaultToolRegistry,
          env: this.options.env,
          streamText: this.options.streamText,
          maxSteps: this.options.maxSteps,
        });
      })();
    }
    return this.loop;
  }

  /** Build the configured scorer, supplying the k-NN scorer its user-label store. */
  private resolveScorer(config: ScoringConfig): Promise<Scorer> {
    const store = config.scorer === "knn" ? this.resolveStore() : undefined;
    return buildScorer(config, { store });
  }

  private resolveStore(): LabeledExampleStore {
    if (this.options.store) return this.options.store;
    const path = this.options.dbPath ?? process.env.TACK_DB_PATH ?? DEFAULT_DB_PATH;
    mkdirSync(dirname(path), { recursive: true });
    return new SqliteLabeledExampleStore(path);
  }

  async *dispatch(context: PromptContext): AsyncIterable<AgentEvent> {
    const system = await buildSystemPrompt();
    const loop = await this.buildLoop();
    yield* loop.run({ ...context, system });
  }
}
