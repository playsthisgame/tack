import { describe, expect, test } from "bun:test";
import type { streamText as StreamTextFn } from "ai";
import type { AgentEvent, PromptContext } from "@tack/core";
import {
  AiSdkDispatcher,
  UnknownProviderError,
  parseModelString,
  resolveModel,
} from "../src/index";

const allKeys = {
  ANTHROPIC_API_KEY: "test-key",
  OPENAI_API_KEY: "test-key",
  GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
};

/**
 * A stand-in for the AI SDK's `streamText` that records its options and emits
 * the given chunks as `fullStream` text-delta events — so the agentic dispatch
 * loop can be tested without any network call. No tool-call events are emitted,
 * so the loop terminates after a single step.
 */
function fakeStreamText(chunks: string[]) {
  const calls: { messages?: unknown }[] = [];
  const fn = ((opts: { messages?: unknown }) => {
    calls.push(opts);
    return {
      fullStream: (async function* () {
        for (const c of chunks) yield { type: "text-delta", textDelta: c };
      })(),
      response: Promise.resolve({ messages: [] }),
    };
  }) as unknown as typeof StreamTextFn;
  return { fn, calls };
}

/** Drain an AgentEvent stream into an array. */
async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of stream) events.push(e);
  return events;
}

describe("parseModelString + resolveModel", () => {
  test("known providers resolve to a model (no network)", () => {
    expect(resolveModel("anthropic/claude-sonnet-4.6", undefined, allKeys)).toBeTruthy();
    expect(resolveModel("openai/gpt-4o", undefined, allKeys)).toBeTruthy();
    expect(resolveModel("google/gemini-1.5-pro", undefined, allKeys)).toBeTruthy();
  });

  test("splits provider and model on the first slash", () => {
    expect(parseModelString("anthropic/claude-sonnet-4.6")).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4.6",
    });
  });

  test("unknown provider raises a clear error", () => {
    expect(() => resolveModel("acme/whatever", undefined, allKeys)).toThrow(
      UnknownProviderError,
    );
    expect(() => resolveModel("acme/whatever", undefined, allKeys)).toThrow(/acme/);
  });

  test("malformed model string raises a clear error", () => {
    expect(() => parseModelString("no-slash-here")).toThrow(UnknownProviderError);
    expect(() => parseModelString("trailing/")).toThrow(UnknownProviderError);
    expect(() => parseModelString("/leading")).toThrow(UnknownProviderError);
  });
});

describe("AiSdkDispatcher key handling", () => {
  test("emits an error event (no network call) when the provider key is absent", async () => {
    const { fn, calls } = fakeStreamText(["unused"]);
    // No keys: the cheap tier's anthropic model cannot resolve.
    const dispatcher = new AiSdkDispatcher({ env: {}, streamText: fn });

    const events = await collect(dispatcher.dispatch({ prompt: "hi", history: [] }));

    // The loop surfaces the missing key as an error event rather than throwing,
    // and never reaches the model call.
    expect(calls.length).toBe(0);
    const error = events.find((e) => e.type === "error");
    expect(error).toBeDefined();
    expect((error as Extract<AgentEvent, { type: "error" }>).message).toContain(
      "ANTHROPIC_API_KEY",
    );
  });
});

describe("AiSdkDispatcher dispatch", () => {
  test("builds messages from the prompt context (injected system, history, prompt)", async () => {
    const { fn, calls } = fakeStreamText(["ok"]);
    const dispatcher = new AiSdkDispatcher({ env: allKeys, streamText: fn });

    const context: PromptContext = {
      history: [
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
      ],
      prompt: "the new question",
    };

    await collect(dispatcher.dispatch(context));

    expect(calls.length).toBe(1);
    const messages = calls[0]!.messages as { role: string; content: string }[];
    // The dispatcher injects an environment system prompt as the first message;
    // the rest is the history followed by the new user prompt, in order.
    expect(messages[0]!.role).toBe("system");
    expect(messages.slice(1)).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "the new question" },
    ]);
  });

  test("streams text incrementally as text-delta events", async () => {
    const { fn } = fakeStreamText(["Hel", "lo, ", "world"]);
    const dispatcher = new AiSdkDispatcher({ env: allKeys, streamText: fn });

    const received: string[] = [];
    for await (const event of dispatcher.dispatch({ prompt: "hi", history: [] })) {
      if (event.type === "text-delta") received.push(event.delta);
    }

    expect(received).toEqual(["Hel", "lo, ", "world"]);
    expect(received.join("")).toBe("Hello, world");
  });
});
