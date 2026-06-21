import { useState } from "react";
import type { Advisory, AgentEvent, PromptContext, RoutingDecision, Tier } from "@tack/core";
import { providerOf, type TackServices } from "./services";

export interface ToolCallEntry {
  id: string;
  toolName: string;
  args: unknown;
  result?: string;
}

export interface AgentStep {
  decision: RoutingDecision;
  model: string;
  toolCalls: ToolCallEntry[];
  response: string;
}

/** One exchange in the session: a prompt, its agentic steps, and final state. */
export interface Turn {
  prompt: string;
  steps: AgentStep[];
  done: boolean;
  inFlight: boolean;
  showWhy: boolean;
  error?: string;
}

/** A dispatch deferred because the routed model's provider key is missing. */
export interface PendingKey {
  provider: string;
  context: PromptContext;
  turnIndex: number;
}

export interface TackState {
  turns: Turn[];
  pendingKey: PendingKey | null;
  /** The most recent advisory, shown until dismissed. Informational only. */
  advisory: Advisory | null;
  submit(input: string): Promise<void>;
  provideKey(key: string): Promise<void>;
  toggleWhy(index: number): void;
  dismissAdvisory(): void;
}

function replace<T>(arr: T[], index: number, update: (item: T) => T): T[] {
  return arr.map((item, i) => (i === index ? update(item) : item));
}

function replaceStep(steps: AgentStep[], index: number, update: (s: AgentStep) => AgentStep): AgentStep[] {
  return steps.map((s, i) => (i === index ? update(s) : s));
}

export function useTack(services: TackServices): TackState {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pendingKey, setPendingKey] = useState<PendingKey | null>(null);
  const [advisory, setAdvisory] = useState<Advisory | null>(null);

  async function runAgent(turnIndex: number, context: PromptContext): Promise<void> {
    let currentStep = -1;

    for await (const event of services.dispatch(context)) {
      switch (event.type) {
        case "dispatching":
          // The loop is scoring and resolving the next model. Keep (or restore)
          // the spinner so the user always sees activity while work is in progress.
          setTurns((prev) =>
            replace(prev, turnIndex, (t) => ({ ...t, inFlight: true })),
          );
          break;
        case "advisory":
          // Surface the latest advisory; it stays until the user dismisses it.
          setAdvisory(event.advisory);
          break;
        case "routing": {
          currentStep = event.step;
          const newStep: AgentStep = {
            decision: event.decision,
            model: event.model,
            toolCalls: [],
            response: "",
          };
          setTurns((prev) =>
            replace(prev, turnIndex, (t) => {
              // Log decision for the first step only.
              if (event.step === 0) {
                services.log(context, event.decision, event.model);
              }
              return { ...t, steps: [...t.steps, newStep] };
            }),
          );
          break;
        }
        case "text-delta":
          setTurns((prev) =>
            replace(prev, turnIndex, (t) => ({
              ...t,
              inFlight: false,
              steps: replaceStep(t.steps, currentStep, (s) => ({
                ...s,
                response: s.response + event.delta,
              })),
            })),
          );
          break;
        case "tool-call":
          setTurns((prev) =>
            replace(prev, turnIndex, (t) => ({
              ...t,
              steps: replaceStep(t.steps, currentStep, (s) => ({
                ...s,
                toolCalls: [...s.toolCalls, { id: event.id, toolName: event.toolName, args: event.args }],
              })),
            })),
          );
          break;
        case "tool-result":
          setTurns((prev) =>
            replace(prev, turnIndex, (t) => ({
              ...t,
              steps: replaceStep(t.steps, currentStep, (s) => ({
                ...s,
                toolCalls: s.toolCalls.map((tc) =>
                  tc.id === event.id ? { ...tc, result: event.result } : tc,
                ),
              })),
            })),
          );
          break;
        case "error":
          setTurns((prev) =>
            replace(prev, turnIndex, (t) => ({
              ...t,
              done: true,
              inFlight: false,
              error: event.message,
            })),
          );
          break;
        case "done":
          setTurns((prev) =>
            replace(prev, turnIndex, (t) => ({ ...t, done: true, inFlight: false })),
          );
          break;
      }
    }
  }

  async function submit(input: string): Promise<void> {
    const prompt = input.trim();
    if (!prompt || pendingKey) return;

    const history = turns.flatMap((t) => [
      { role: "user" as const, content: t.prompt },
      {
        role: "assistant" as const,
        content: t.steps.map((s) => s.response).join(""),
      },
    ]);
    const context: PromptContext = { prompt, history };
    const turnIndex = turns.length;

    setTurns((prev) => [
      ...prev,
      { prompt, steps: [], done: false, inFlight: true, showWhy: false },
    ]);

    // Check if a key is needed: score to find provider, then check.
    const decision = await services.score(context);
    const model = services.modelFor(decision.tier);
    const provider = providerOf(model);
    if (services.resolveKey(provider) === undefined) {
      setPendingKey({ provider, context, turnIndex });
      return;
    }

    await runAgent(turnIndex, context);
  }

  async function provideKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (!pendingKey || !trimmed) return;
    const { provider, context, turnIndex } = pendingKey;
    services.saveKey(provider, trimmed, true);
    setPendingKey(null);
    await runAgent(turnIndex, context);
  }

  function toggleWhy(index: number): void {
    setTurns((prev) => replace(prev, index, (t) => ({ ...t, showWhy: !t.showWhy })));
  }

  function dismissAdvisory(): void {
    setAdvisory(null);
  }

  return { turns, pendingKey, advisory, submit, provideKey, toggleWhy, dismissAdvisory };
}
