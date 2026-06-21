import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSeedFile } from "../src/index";

describe("seed file loading", () => {
  test("the shipped seed file loads and validates without error", () => {
    const file = loadSeedFile();
    expect(file.model).toBe("Xenova/all-MiniLM-L6-v2");
    expect(file.dimension).toBe(384);
    expect(typeof file.version).toBe("number");
    // The curated set may grow over time; every example must carry the authored
    // fields (loadSeedFile throws otherwise, so reaching here means they all do).
    expect(Array.isArray(file.examples)).toBe(true);
    for (const ex of file.examples) {
      expect(["cheap", "mid", "frontier"]).toContain(ex.tier);
      expect(["seed", "user"]).toContain(ex.source);
    }
  });
});

describe("empty seed file", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tack-seed-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("an empty examples array loads with zero examples and no error", () => {
    const path = join(dir, "seeds.json");
    writeFileSync(
      path,
      JSON.stringify({ model: "Xenova/all-MiniLM-L6-v2", dimension: 384, version: 1, examples: [] }),
    );
    const file = loadSeedFile(path);
    expect(file.examples).toEqual([]);
  });
});
