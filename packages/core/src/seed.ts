import { readFileSync } from "node:fs";
import type { LabeledExample, SeedFile, Tier } from "./types";
// The shipped seed set is embedded via a static import rather than read from a
// sibling file at runtime: `bun build --compile` bundles imported JSON into the
// binary, but a `readFileSync(join(import.meta.dir, ...))` would point at a path
// that doesn't exist inside the compiled executable.
import shippedSeeds from "./seeds.json";

const TIERS: ReadonlySet<string> = new Set<Tier>(["cheap", "mid", "frontier"]);
const SOURCES: ReadonlySet<string> = new Set(["seed", "user"]);

/**
 * Read and validate a seed file. With no `path`, returns the embedded shipped
 * seed set; with a `path`, reads and validates that file from disk. An empty
 * `examples` array is fully valid — Tack ships an empty seed set and the
 * build/load must not fail on it. Throws only on a structurally malformed file
 * (so corruption is loud, not silently dropped).
 */
export function loadSeedFile(path?: string): SeedFile {
  const raw: unknown =
    path === undefined ? shippedSeeds : JSON.parse(readFileSync(path, "utf8"));
  const label = path ?? "<shipped seeds>";
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`seed file ${label}: expected a JSON object`);
  }
  const file = raw as Partial<SeedFile>;
  if (typeof file.model !== "string" || typeof file.dimension !== "number") {
    throw new Error(`seed file ${label}: missing model/dimension`);
  }
  if (typeof file.version !== "number") {
    throw new Error(`seed file ${label}: missing version`);
  }
  const examples = file.examples ?? [];
  if (!Array.isArray(examples)) {
    throw new Error(`seed file ${label}: examples must be an array`);
  }
  for (const ex of examples) {
    validateExample(ex, label);
  }
  return { model: file.model, dimension: file.dimension, version: file.version, examples };
}

/** A seed example carries exactly id/prompt/tier/source — never an authored vector. */
function validateExample(ex: unknown, path: string): asserts ex is LabeledExample {
  const e = ex as Partial<LabeledExample> & Record<string, unknown>;
  if (typeof e.id !== "string" || typeof e.prompt !== "string") {
    throw new Error(`seed file ${path}: example missing id/prompt`);
  }
  if (typeof e.tier !== "string" || !TIERS.has(e.tier)) {
    throw new Error(`seed file ${path}: example ${e.id} has invalid tier ${String(e.tier)}`);
  }
  if (typeof e.source !== "string" || !SOURCES.has(e.source)) {
    throw new Error(`seed file ${path}: example ${e.id} has invalid source ${String(e.source)}`);
  }
  if ("embedding" in e && e.embedding !== undefined) {
    throw new Error(`seed file ${path}: example ${e.id} must not carry an authored embedding`);
  }
}
