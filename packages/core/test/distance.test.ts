import { describe, expect, test } from "bun:test";
import { cosineDistance, cosineSimilarity } from "../src/index";

describe("cosine distance", () => {
  test("identical vectors have similarity ≈ 1.0 and distance ≈ 0", () => {
    const a = new Float32Array([0.2, 0.5, -0.1, 0.84]);
    const b = new Float32Array([0.2, 0.5, -0.1, 0.84]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    expect(cosineDistance(a, b)).toBeCloseTo(0.0, 5);
  });

  test("orthogonal vectors have similarity 0", () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 6);
  });

  test("differing lengths raise an error rather than a silent result", () => {
    expect(() => cosineDistance(new Float32Array([1, 0, 0]), new Float32Array([1, 0]))).toThrow(
      /length mismatch/,
    );
    expect(() => cosineSimilarity(new Float32Array([1]), new Float32Array([1, 2]))).toThrow();
  });
});
