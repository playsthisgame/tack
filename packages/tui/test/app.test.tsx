import React from "react";
import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import type { RoutingDecision } from "@tack/core";
import { App, TurnView } from "../src/app";
import type { TackServices } from "../src/services";

const decision: RoutingDecision = {
  tier: "mid",
  score: 3,
  contributions: [{ signal: "keyword:refactor", detail: 'mentions "refactor"', weight: 2 }],
  tokenCount: 5,
};

async function* gen(chunks: string[]): AsyncIterable<string> {
  for (const c of chunks) yield c;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll the frame until it satisfies `check`, or fail after `timeout`. */
async function waitFor(
  lastFrame: () => string | undefined,
  check: (frame: string) => boolean,
  timeout = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const frame = lastFrame();
    if (frame && check(frame)) return;
    await sleep(15);
  }
  throw new Error(`timed out; last frame:\n${lastFrame()}`);
}

/** Type a prompt and submit it (Enter after the value has committed). */
async function submitPrompt(stdin: { write(s: string): void }, text: string): Promise<void> {
  await sleep(30); // let Ink mount and attach its stdin listener
  stdin.write(text);
  await sleep(30); // let the controlled value commit before Enter
  stdin.write("\r");
}

function makeServices(overrides: Partial<TackServices> = {}): TackServices {
  return {
    score: async () => decision,
    modelFor: () => "anthropic/claude-sonnet-4.6",
    log: () => {},
    dispatch: async () => ({ textStream: gen(["Hel", "lo"]) }),
    resolveKey: () => "present",
    saveKey: () => {},
    ...overrides,
  };
}

describe("App", () => {
  test("shows the routed tier and model after submitting a prompt", async () => {
    const { stdin, lastFrame } = render(<App services={makeServices()} />);
    await submitPrompt(stdin, "refactor the auth module");

    await waitFor(lastFrame, (f) => f.includes("mid") && f.includes("anthropic/claude-sonnet-4.6"));
  });

  test("streams the response incrementally into the turn", async () => {
    const { stdin, lastFrame } = render(<App services={makeServices()} />);
    await submitPrompt(stdin, "hi");

    await waitFor(lastFrame, (f) => f.includes("Hello"));
  });

  test("prompts for a missing key instead of dispatching", async () => {
    let dispatched = false;
    const services = makeServices({
      resolveKey: () => undefined,
      dispatch: async () => {
        dispatched = true;
        return { textStream: gen(["should not run"]) };
      },
    });
    const { stdin, lastFrame } = render(<App services={services} />);
    await submitPrompt(stdin, "hello");

    await waitFor(lastFrame, (f) => f.includes("no API key"));
    // Provider is named, the badge still shows, and dispatch never ran.
    expect(lastFrame()).toContain("anthropic");
    expect(lastFrame()).toContain("anthropic/claude-sonnet-4.6");
    expect(dispatched).toBe(false);
  });

  test("dispatches after the key is provided and saves it", async () => {
    let savedKey: string | undefined;
    const env: Record<string, string> = {};
    const services = makeServices({
      resolveKey: (p) => env[p],
      saveKey: (p, key) => {
        env[p] = key;
        savedKey = key;
      },
    });
    const { stdin, lastFrame } = render(<App services={services} />);
    await submitPrompt(stdin, "hello");
    await waitFor(lastFrame, (f) => f.includes("no API key"));

    await sleep(30); // let the KeyPrompt's input mount before typing the key
    stdin.write("sk-test-123");
    await sleep(30);
    stdin.write("\r");

    await waitFor(lastFrame, (f) => f.includes("Hello"));
    expect(savedKey).toBe("sk-test-123");
  });
});

describe("TurnView rationale toggle", () => {
  const turn = {
    prompt: "refactor",
    decision,
    model: "anthropic/claude-sonnet-4.6",
    response: "",
    done: false,
    showWhy: false,
  };

  test("hides the signal breakdown by default", () => {
    const { lastFrame } = render(<TurnView turn={turn} />);
    expect(lastFrame()).not.toContain('mentions "refactor"');
  });

  test("shows the signal breakdown when toggled on", () => {
    const { lastFrame } = render(<TurnView turn={{ ...turn, showWhy: true }} />);
    expect(lastFrame()).toContain('mentions "refactor"');
    expect(lastFrame()).toContain("+2");
  });
});
