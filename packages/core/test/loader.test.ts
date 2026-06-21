import { describe, expect, test } from "bun:test";
import {
  loadLabeledSet,
  SqliteLabeledExampleStore,
  type Embedder,
  type SeedFile,
} from "../src/index";

/** Deterministic 2-dim embedder; records every prompt it is asked to embed. */
class FakeEmbedder implements Embedder {
  readonly calls: string[] = [];
  constructor(
    readonly model = "fake-v1",
    readonly dimension = 2,
  ) {}
  async embed(text: string): Promise<Float32Array> {
    this.calls.push(text);
    return new Float32Array([text.length % 5, 1]);
  }
}

const emptySeeds: SeedFile = { model: "fake-v1", dimension: 2, version: 1, examples: [] };

describe("loadLabeledSet — model guard", () => {
  test("re-embeds a cached example whose model differs from the active embedder", async () => {
    const store = new SqliteLabeledExampleStore(":memory:");
    store.add("u1", "find the race condition", "frontier");
    // Pretend a stale vector was cached under a different model.
    store.saveEmbedding("u1", new Float32Array([9, 9]), "old-model", 2);

    const embedder = new FakeEmbedder();
    const set = await loadLabeledSet({ embedder, seedFile: emptySeeds, store });

    // It was re-embedded under the active model...
    expect(embedder.calls).toContain("find the race condition");
    expect(set).toHaveLength(1);
    expect(set[0]!.model).toBe("fake-v1");
    // ...and the fresh vector was written back, tagged with the active model.
    const stored = store.all()[0]!;
    expect(stored.model).toBe("fake-v1");
    expect(stored.embedding).toEqual(new Float32Array([("find the race condition".length % 5), 1]));
  });

  test("every returned vector carries the active model (never cross-model)", async () => {
    const store = new SqliteLabeledExampleStore(":memory:");
    store.add("u1", "a", "cheap");
    store.add("u2", "bb", "mid");
    const embedder = new FakeEmbedder();
    const set = await loadLabeledSet({ embedder, seedFile: emptySeeds, store });
    expect(set.every((e) => e.model === "fake-v1")).toBe(true);
  });
});

describe("loadLabeledSet — provenance merge", () => {
  test("user label overrides seed label for equivalent prompt content", async () => {
    const seedFile: SeedFile = {
      model: "fake-v1",
      dimension: 2,
      version: 1,
      examples: [{ id: "s1", prompt: "Do The Thing", tier: "mid", source: "seed" }],
    };
    const store = new SqliteLabeledExampleStore(":memory:");
    store.add("u1", "do the thing", "frontier"); // same content, different case

    const embedder = new FakeEmbedder();
    const set = await loadLabeledSet({ embedder, seedFile, store });

    expect(set).toHaveLength(1);
    expect(set[0]!.tier).toBe("frontier");
    expect(set[0]!.source).toBe("user");
  });

  test("an empty store + empty seeds yields an empty set without error", async () => {
    const set = await loadLabeledSet({ embedder: new FakeEmbedder(), seedFile: emptySeeds });
    expect(set).toEqual([]);
  });
});
