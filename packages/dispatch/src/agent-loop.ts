import { streamText as defaultStreamText, type CoreMessage } from "ai";
import {
  SessionTracker,
  type AgentEvent,
  type PromptContext,
  type RoutingDecision,
  type Scorer,
  type ScoringConfig,
} from "@tack/core";
import { defaultRegistry, resolveModel, type ProviderRegistry } from "./providers";
import { defaultToolRegistry, type ToolRegistry } from "./tools";

type StreamText = typeof defaultStreamText;

const DEFAULT_MAX_STEPS = 20;

export interface AgentLoopOptions {
  scorer: Scorer;
  config: ScoringConfig;
  registry?: ProviderRegistry;
  tools?: ToolRegistry;
  env?: Record<string, string | undefined>;
  streamText?: StreamText;
  maxSteps?: number;
  /**
   * Tracks context-driven escalations across turns. One loop instance is reused
   * for a whole session, so the tracker accumulates across user turns; an
   * explicit tracker can be injected for tests.
   */
  session?: SessionTracker;
}

function toMessages(context: PromptContext): CoreMessage[] {
  const messages: CoreMessage[] = [];
  if (context.system) {
    messages.push({ role: "system", content: context.system });
  }
  for (const m of context.history) {
    messages.push({ role: m.role as "user" | "assistant", content: m.content });
  }
  messages.push({ role: "user", content: context.prompt });
  return messages;
}

export class AgentLoop {
  private readonly scorer: Scorer;
  private readonly config: ScoringConfig;
  private readonly providerRegistry: ProviderRegistry;
  private readonly tools: ToolRegistry;
  private readonly env: Record<string, string | undefined>;
  private readonly streamText: StreamText;
  private readonly maxSteps: number;
  private readonly session: SessionTracker;

  constructor(options: AgentLoopOptions) {
    this.scorer = options.scorer;
    this.config = options.config;
    this.providerRegistry = options.registry ?? defaultRegistry;
    this.tools = options.tools ?? defaultToolRegistry;
    this.env = options.env ?? process.env;
    this.streamText = options.streamText ?? defaultStreamText;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.session = options.session ?? new SessionTracker(this.config);
  }

  async *run(context: PromptContext): AsyncIterable<AgentEvent> {
    try {
      let messages: CoreMessage[] = toMessages(context);

      for (let step = 0; step < this.maxSteps; step++) {
        // Score the accumulated context for this step.
        const decision: RoutingDecision = await this.scorer.score({
          prompt: context.prompt,
          history: context.history,
          system: context.system,
        });

        // Hard stop: if no model can hold the context, surface a blocking
        // advisory and dispatch nothing. Tack never compacts on its own.
        if (decision.exceedsAllWindows) {
          yield { type: "advisory", advisory: this.session.blockingAdvisory(decision) };
          yield { type: "done" };
          return;
        }

        // Count context-driven escalations once per user turn (first step only),
        // and surface the passive cost advisory if the threshold is crossed.
        if (step === 0) {
          const advisory = this.session.record(decision);
          if (advisory) yield { type: "advisory", advisory };
        }

        const model = this.config.tierModels[decision.tier];
        const languageModel = resolveModel(model, this.providerRegistry, this.env);

        yield { type: "routing", step, decision, model };

        const result = this.streamText({
          model: languageModel,
          messages,
          tools: this.tools,
          maxSteps: 1,
        });

        let hasToolCalls = false;

        for await (const event of result.fullStream) {
          switch (event.type) {
            case "text-delta":
              yield { type: "text-delta", delta: event.textDelta };
              break;
            case "tool-call":
              hasToolCalls = true;
              yield {
                type: "tool-call",
                id: event.toolCallId,
                toolName: event.toolName,
                args: event.args,
              };
              break;
            case "tool-result":
              yield {
                type: "tool-result",
                id: event.toolCallId,
                toolName: event.toolName,
                result: String(event.result),
              };
              break;
            case "error":
              throw event.error instanceof Error ? event.error : new Error(String(event.error));
          }
        }

        if (!hasToolCalls) break;

        // Append the step's assistant + tool-result messages for the next iteration.
        const { messages: stepMessages } = await result.response;
        messages = [...messages, ...stepMessages];
      }

      yield { type: "done" };
    } catch (err) {
      yield { type: "error", message: (err as Error).message ?? String(err) };
      yield { type: "done" };
    }
  }
}
