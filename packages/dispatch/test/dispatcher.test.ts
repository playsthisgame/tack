import { describe, expect, test } from "bun:test";
import type { streamText as StreamTextFn } from "ai";
import type { PromptContext } from "@tack/core";
import {
  AiSdkDispatcher,
  MissingApiKeyError,
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
 * A stand-in for the AI SDK's `streamText` that records its options and yields
 * the given chunks — so dispatch can be tested without any network call.
 */
function fakeStreamText(chunks: string[]) {
  const calls: { messages?: unknown }[] = [];
  const fn = ((opts: { messages?: unknown }) => {
    calls.push(opts);
    return {
      textStream: (async function* () {
        for (const c of chunks) yield c;
      })(),
    };
  }) as unknown as typeof StreamTextFn;
  return { fn, calls };
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
  test("fails fast with MissingApiKeyError when the key is absent, no network call", async () => {
    const { fn, calls } = fakeStreamText(["unused"]);
    const dispatcher = new AiSdkDispatcher({ env: {}, streamText: fn });

    await expect(
      dispatcher.dispatch("anthropic/claude-sonnet-4.6", {
        prompt: "hi",
        history: [],
      }),
    ).rejects.toBeInstanceOf(MissingApiKeyError);
    expect(calls.length).toBe(0);
  });
});

describe("AiSdkDispatcher dispatch", () => {
  test("builds messages from the prompt context (system, history, prompt)", async () => {
    const { fn, calls } = fakeStreamText(["ok"]);
    const dispatcher = new AiSdkDispatcher({ env: allKeys, streamText: fn });

    const context: PromptContext = {
      system: "you are terse",
      history: [
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
      ],
      prompt: "the new question",
    };

    await dispatcher.dispatch("anthropic/claude-sonnet-4.6", context);

    expect(calls.length).toBe(1);
    expect(calls[0]!.messages).toEqual([
      { role: "system", content: "you are terse" },
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "the new question" },
    ]);
  });

  test("streams text incrementally as an async iterable of strings", async () => {
    const { fn } = fakeStreamText(["Hel", "lo, ", "world"]);
    const dispatcher = new AiSdkDispatcher({ env: allKeys, streamText: fn });

    const { textStream } = await dispatcher.dispatch("openai/gpt-4o", {
      prompt: "hi",
      history: [],
    });

    const received: string[] = [];
    for await (const chunk of textStream) received.push(chunk);

    expect(received).toEqual(["Hel", "lo, ", "world"]);
    expect(received.join("")).toBe("Hello, world");
  });
});
