import { describe, expect, test } from "bun:test";
import type { streamText as StreamTextFn } from "ai";
import {
  defaultConfig,
  type AgentEvent,
  type RoutingDecision,
  type Scorer,
} from "@tack/core";
import { AgentLoop } from "../src/agent-loop";

function fakeScorer(decision: RoutingDecision): Scorer {
  return { score: async () => decision };
}

/** A `streamText` that fails the test if it is ever called. */
const neverStream = (() => {
  throw new Error("streamText must not be called when context exceeds all windows");
}) as unknown as typeof StreamTextFn;

async function collect(loop: AgentLoop): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of loop.run({ prompt: "fix this typo", history: [] })) {
    events.push(e);
  }
  return events;
}

describe("AgentLoop — blocking advisory", () => {
  test("emits a compaction-required advisory and dispatches nothing", async () => {
    const decision: RoutingDecision = {
      tier: "frontier",
      preferredTier: "cheap",
      escalated: false,
      exceedsAllWindows: true,
      score: 0,
      contributions: [],
      tokenCount: 5_000_000,
      confidence: 0,
      neighbors: [],
    };
    const loop = new AgentLoop({
      scorer: fakeScorer(decision),
      config: defaultConfig,
      streamText: neverStream,
    });

    const events = await collect(loop);

    // Only the advisory and the done signal — no routing, no text, no tools.
    expect(events.map((e) => e.type)).toEqual(["advisory", "done"]);
    const first = events[0]!;
    expect(first.type).toBe("advisory");
    if (first.type === "advisory") {
      expect(first.advisory.kind).toBe("compaction-required");
    }
  });
});
