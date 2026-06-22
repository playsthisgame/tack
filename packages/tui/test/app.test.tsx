import React from "react";
import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import type { AgentEvent, RoutingDecision, Tier } from "@tack/core";
import { App, TurnView } from "../src/app";
import type { TackServices } from "../src/services";
import type { Turn } from "../src/useTack";

const MODEL = "anthropic/claude-sonnet-4.6";

const decision: RoutingDecision = {
  tier: "mid",
  preferredTier: "mid",
  escalated: false,
  exceedsAllWindows: false,
  score: 3,
  contributions: [{ signal: "keyword:refactor", detail: 'mentions "refactor"', weight: 2 }],
  tokenCount: 5,
  confidence: 0.6,
  neighbors: [],
};

/**
 * A stand-in agent stream: one routing step, the given text chunks, then done —
 * the shape `services.dispatch` now yields.
 */
async function* agentStream(chunks: string[]): AsyncIterable<AgentEvent> {
  yield { type: "routing", step: 0, decision, model: MODEL };
  for (const c of chunks) yield { type: "text-delta", delta: c };
  yield { type: "done" };
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
    modelFor: () => MODEL,
    tierModels: () => ({
      cheap: "anthropic/claude-haiku-4-5",
      mid: "anthropic/claude-sonnet-4-6",
      frontier: "anthropic/claude-opus-4-8",
    }),
    setTierModel: () => ({ ok: true }),
    log: () => {},
    dispatch: () => agentStream(["Hel", "lo"]),
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

  test("typing 'exit' quits without dispatching or adding a turn", async () => {
    let dispatched = false;
    const services = makeServices({
      dispatch: () => {
        dispatched = true;
        return agentStream(["nope"]);
      },
    });
    const { stdin, lastFrame } = render(<App services={services} />);
    await submitPrompt(stdin, "exit");
    await sleep(50);

    expect(dispatched).toBe(false);
    expect(lastFrame() ?? "").not.toContain("› exit");
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
      dispatch: () => {
        dispatched = true;
        return agentStream(["should not run"]);
      },
    });
    const { stdin, lastFrame } = render(<App services={services} />);
    await submitPrompt(stdin, "hello");

    await waitFor(lastFrame, (f) => f.includes("no API key"));
    // The provider is named in the key prompt, and dispatch never ran (routing
    // happens inside the agent loop, so no model badge shows pre-dispatch).
    expect(lastFrame()).toContain("anthropic");
    expect(dispatched).toBe(false);
  });

  test("^w toggles the rationale without leaking a 'w' into the input", async () => {
    const { stdin, lastFrame } = render(<App services={makeServices()} />);
    await submitPrompt(stdin, "refactor the auth module");
    await waitFor(lastFrame, (f) => f.includes("Hello"));

    // Rationale is hidden until toggled.
    expect(lastFrame()).not.toContain('mentions "refactor"');

    stdin.write("\x17"); // Ctrl-W
    await waitFor(lastFrame, (f) => f.includes('mentions "refactor"'));

    // The input buffer stayed empty (placeholder shows) — no stray "w" was typed.
    expect(lastFrame()).toContain("ask anything…");
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

// "esc cancel" appears only in the editor; "configure tier models" also appears in
// the welcome panel's key hints, so use the former to detect open/closed reliably.
const EDITOR_MARKER = "esc cancel";

describe("tier-model editor (^t)", () => {
  test("^t opens the editor listing each tier and its model", async () => {
    const { stdin, lastFrame } = render(<App services={makeServices()} />);
    await sleep(30);
    stdin.write("\x14"); // Ctrl-T

    await waitFor(lastFrame, (f) => f.includes(EDITOR_MARKER));
    expect(lastFrame()).toContain("› cheap"); // selected-tier row, editor-only
    expect(lastFrame()).toContain("anthropic/claude-opus-4-8"); // frontier row
  });

  test("esc dismisses the editor without changing anything (and no 't' leaks)", async () => {
    const saved: unknown[] = [];
    const services = makeServices({
      setTierModel: (...args) => {
        saved.push(args);
        return { ok: true };
      },
    });
    const { stdin, lastFrame } = render(<App services={services} />);
    await sleep(30);
    stdin.write("\x14"); // open
    await waitFor(lastFrame, (f) => f.includes(EDITOR_MARKER));
    await sleep(30); // let the editor attach its stdin listener
    stdin.write("\x1b"); // Esc

    await waitFor(lastFrame, (f) => f.includes("ask anything…") && !f.includes(EDITOR_MARKER));
    expect(saved).toHaveLength(0); // nothing persisted
  });

  test("typing an invalid model shows an error and does not save", async () => {
    const services = makeServices({
      setTierModel: (tier, model) => ({
        ok: false,
        error: `unknown provider "${model.split("/")[0]}"`,
      }),
    });
    const { stdin, lastFrame } = render(<App services={services} />);
    await sleep(30);
    stdin.write("\x14"); // open (cheap selected)
    await waitFor(lastFrame, (f) => f.includes(EDITOR_MARKER));
    await sleep(30); // let the editor input attach
    stdin.write("acme/x");
    await sleep(30);
    stdin.write("\r");

    await waitFor(lastFrame, (f) => f.includes('unknown provider "acme"'));
    expect(lastFrame()).toContain(EDITOR_MARKER); // editor still open
  });

  test("typing a valid model saves it and closes the editor", async () => {
    const saved: { tier: Tier; model: string }[] = [];
    const services = makeServices({
      setTierModel: (tier, model) => {
        saved.push({ tier, model });
        return { ok: true };
      },
    });
    const { stdin, lastFrame } = render(<App services={services} />);
    await sleep(30);
    stdin.write("\x14"); // open (cheap selected)
    await waitFor(lastFrame, (f) => f.includes(EDITOR_MARKER));
    await sleep(30); // let the editor input attach
    stdin.write("anthropic/claude-sonnet-4-6");
    await sleep(30);
    stdin.write("\r");

    await waitFor(lastFrame, (f) => !f.includes(EDITOR_MARKER));
    expect(saved).toEqual([{ tier: "cheap", model: "anthropic/claude-sonnet-4-6" }]);
  });
});

describe("TurnView rationale toggle", () => {
  const turn: Turn = {
    prompt: "refactor",
    steps: [{ decision, model: MODEL, toolCalls: [], response: "" }],
    done: false,
    inFlight: false,
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
