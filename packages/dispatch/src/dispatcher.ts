import { streamText as defaultStreamText } from "ai";
import {
  BpeTokenizer,
  HeuristicScorer,
  defaultConfig,
  type AgentEvent,
  type Dispatcher,
  type PromptContext,
  type Scorer,
  type ScoringConfig,
} from "@tack/core";
import { defaultRegistry, type ProviderRegistry } from "./providers";
import { defaultToolRegistry, type ToolRegistry } from "./tools";
import { AgentLoop } from "./agent-loop";
import { buildSystemPrompt } from "./context";

type StreamText = typeof defaultStreamText;

export interface AiSdkDispatcherOptions {
  registry?: ProviderRegistry;
  env?: Record<string, string | undefined>;
  tools?: ToolRegistry;
  scorer?: Scorer;
  config?: ScoringConfig;
  streamText?: StreamText;
  maxSteps?: number;
}

export class AiSdkDispatcher implements Dispatcher {
  private readonly loop: AgentLoop;

  constructor(options: AiSdkDispatcherOptions = {}) {
    const scorer = options.scorer ?? new HeuristicScorer(defaultConfig, new BpeTokenizer());
    const config = options.config ?? defaultConfig;

    this.loop = new AgentLoop({
      scorer,
      config,
      registry: options.registry,
      tools: options.tools ?? defaultToolRegistry,
      env: options.env,
      streamText: options.streamText,
      maxSteps: options.maxSteps,
    });
  }

  async *dispatch(context: PromptContext): AsyncIterable<AgentEvent> {
    const system = await buildSystemPrompt();
    yield* this.loop.run({ ...context, system });
  }
}
