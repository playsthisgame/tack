/**
 * Cosine similarity / distance over embedding vectors.
 *
 * Distance, not similarity, is what the k-NN scorer ranks on, but both are exposed
 * because similarity reads more naturally in tests and explanations. The two are
 * complements: `distance = 1 - similarity`.
 */

/**
 * Cosine similarity between two equal-length vectors, in [-1, 1] (1 = identical
 * direction). Throws on differing lengths rather than returning a silent, wrong
 * result — comparing vectors of different shape is always a bug upstream (often a
 * cross-model mix-up the loader is meant to prevent).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: vector length mismatch (${a.length} vs ${b.length})`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0; // a zero vector has no direction
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Cosine distance: `1 - cosineSimilarity`, in [0, 2]. 0 means identical direction,
 * larger means farther apart. Inherits the length-mismatch rejection.
 */
export function cosineDistance(a: Float32Array, b: Float32Array): number {
  return 1 - cosineSimilarity(a, b);
}
