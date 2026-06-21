import { describe, expect, test } from "bun:test";
import { DEFAULT_EMBED_DIMENSION, DEFAULT_EMBED_MODEL, TransformersEmbedder } from "../src/index";

// Loads the real local model on first call (downloads + caches it), so it is given
// a generous timeout. It exercises the model-tagging and dimension contract; the
// faster, deterministic scorer/loader tests use a fake embedder.
describe("TransformersEmbedder (local model)", () => {
  test(
    "returns a 384-dim vector tagged with the right model",
    async () => {
      const embedder = new TransformersEmbedder();
      expect(embedder.model).toBe(DEFAULT_EMBED_MODEL);
      expect(embedder.dimension).toBe(DEFAULT_EMBED_DIMENSION);

      const vec = await embedder.embed("rename this variable");
      expect(vec).toBeInstanceOf(Float32Array);
      expect(vec.length).toBe(384);
    },
    180_000,
  );
});
