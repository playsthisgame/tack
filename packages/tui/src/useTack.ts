import { useState } from "react";
import type { PromptContext, RoutingDecision } from "@tack/core";
import { providerOf, type TackServices } from "./services";

/** One exchange in the session: a prompt, its routing decision, and the response. */
export interface Turn {
  prompt: string;
  decision: RoutingDecision;
  model: string;
  response: string;
  done: boolean;
  showWhy: boolean;
  error?: string;
}

/** A dispatch deferred because the routed model's provider key is missing. */
export interface PendingKey {
  provider: string;
  model: string;
  context: PromptContext;
  turnIndex: number;
}

export interface TackState {
  turns: Turn[];
  pendingKey: PendingKey | null;
  submit(input: string): Promise<void>;
  provideKey(key: string): Promise<void>;
  toggleWhy(index: number): void;
}

function replace<T>(arr: T[], index: number, update: (item: T) => T): T[] {
  return arr.map((item, i) => (i === index ? update(item) : item));
}

export function useTack(services: TackServices): TackState {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pendingKey, setPendingKey] = useState<PendingKey | null>(null);

  async function streamInto(turnIndex: number, model: string, context: PromptContext): Promise<void> {
    try {
      const { textStream } = await services.dispatch(model, context);
      for await (const chunk of textStream) {
        setTurns((prev) => replace(prev, turnIndex, (t) => ({ ...t, response: t.response + chunk })));
      }
      setTurns((prev) => replace(prev, turnIndex, (t) => ({ ...t, done: true })));
    } catch (err) {
      setTurns((prev) =>
        replace(prev, turnIndex, (t) => ({ ...t, done: true, error: (err as Error).message })),
      );
    }
  }

  async function submit(input: string): Promise<void> {
    const prompt = input.trim();
    if (!prompt || pendingKey) return;

    // Prior turns become history so scoring and dispatch see the whole session.
    const history = turns.flatMap((t) => [
      { role: "user" as const, content: t.prompt },
      { role: "assistant" as const, content: t.response },
    ]);
    const context: PromptContext = { prompt, history };

    const decision = await services.score(context);
    const model = services.modelFor(decision.tier);
    const turnIndex = turns.length;

    // Show the routed tier + model immediately — before any response streams.
    setTurns((prev) => [
      ...prev,
      { prompt, decision, model, response: "", done: false, showWhy: false },
    ]);
    services.log(context, decision, model);

    const provider = providerOf(model);
    if (services.resolveKey(provider) === undefined) {
      // Defer dispatch until the user supplies the key.
      setPendingKey({ provider, model, context, turnIndex });
      return;
    }
    await streamInto(turnIndex, model, context);
  }

  async function provideKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (!pendingKey || !trimmed) return;
    const { provider, model, context, turnIndex } = pendingKey;
    services.saveKey(provider, trimmed, true);
    setPendingKey(null);
    await streamInto(turnIndex, model, context);
  }

  function toggleWhy(index: number): void {
    setTurns((prev) => replace(prev, index, (t) => ({ ...t, showWhy: !t.showWhy })));
  }

  return { turns, pendingKey, submit, provideKey, toggleWhy };
}
