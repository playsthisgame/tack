import type { Embedder } from "./types";

/** The local model Tack embeds with, and its output dimension. */
export const DEFAULT_EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
export const DEFAULT_EMBED_DIMENSION = 384;

// The transformers.js feature-extraction pipeline, typed loosely so we don't take
// a compile-time dependency on the library's types (it's a heavy, optional dep).
type FeatureExtractor = (
  text: string,
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array | number[] }>;

/**
 * Local embedder backed by `transformers.js`. The model is downloaded once (cached
 * to disk by the library) and the pipeline is constructed lazily on first use, then
 * reused for every subsequent `embed` — so after warm-up there is no network on the
 * routing hot path. Every vector is tagged with `model`/`dimension` via this
 * instance's readonly fields, which the loader uses as its cross-model guard.
 */
export class TransformersEmbedder implements Embedder {
  readonly model: string;
  readonly dimension: number;
  /** Cached pipeline promise — created once, awaited by every `embed`. */
  private extractor: Promise<FeatureExtractor> | null = null;

  constructor(
    model: string = DEFAULT_EMBED_MODEL,
    dimension: number = DEFAULT_EMBED_DIMENSION,
  ) {
    this.model = model;
    this.dimension = dimension;
  }

  /** Build (or reuse) the feature-extraction pipeline. Loads the model once. */
  private pipeline(): Promise<FeatureExtractor> {
    if (this.extractor === null) {
      // Dynamic import keeps the heavy dependency off the cold path for callers
      // (heuristic scorer, CLI score) that never embed.
      this.extractor = import("@xenova/transformers").then(({ pipeline }) =>
        pipeline("feature-extraction", this.model),
      ) as Promise<FeatureExtractor>;
    }
    return this.extractor;
  }

  async embed(text: string): Promise<Float32Array> {
    const extract = await this.pipeline();
    // Mean-pool token embeddings and L2-normalize so cosine distance is meaningful.
    const output = await extract(text, { pooling: "mean", normalize: true });
    const vec = output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
    if (vec.length !== this.dimension) {
      throw new Error(
        `embedder: model ${this.model} produced ${vec.length} dims, expected ${this.dimension}`,
      );
    }
    return vec;
  }
}
