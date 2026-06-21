import { loadSeedFile } from "./seed";
import type { LabeledExampleStore, StoredLabeledExample } from "./labeled-store";
import type { Embedder, EmbeddedExample, LabeledExample, SeedFile } from "./types";

export interface LoadLabeledSetOptions {
  /** The active embedder; defines the model/dimension every vector must match. */
  embedder: Embedder;
  /** Seed examples. Defaults to the shipped `seeds.json`. */
  seedFile?: SeedFile;
  /** The user's labeled-example store. Omitted means seed-only. */
  store?: LabeledExampleStore;
}

/** Merge priority — a user label always wins over a seed label for the same prompt. */
const PRIORITY = { seed: 1, user: 2 } as const;

/**
 * Build the in-memory labeled set the k-NN scorer ranks against: seed examples plus
 * the user's own, each embedded under the active model, merged so a user label wins
 * over a seed label for equivalent prompt content.
 *
 * The model guard is the crux: an example is re-embedded whenever it has no cached
 * vector OR its cached `model`/`dimension` differs from the active embedder's, so a
 * distance is never computed between vectors from different models.
 */
export async function loadLabeledSet(opts: LoadLabeledSetOptions): Promise<EmbeddedExample[]> {
  const { embedder, store } = opts;
  const seedFile = opts.seedFile ?? loadSeedFile();

  const seeds: LabeledExample[] = seedFile.examples.map((e) => ({ ...e, source: "seed" }));
  const users: StoredLabeledExample[] = store?.all() ?? [];

  const embedded: EmbeddedExample[] = [];

  // Seeds are authored without vectors — always embed under the active model.
  for (const ex of seeds) {
    embedded.push({ ...ex, embedding: await embedder.embed(ex.prompt), model: embedder.model });
  }

  // Users may carry a cached vector. Reuse it only if it matches the active model
  // AND dimension; otherwise recompute and cache the fresh one.
  for (const ex of users) {
    const usable =
      ex.embedding !== undefined &&
      ex.model === embedder.model &&
      ex.dimension === embedder.dimension;

    let embedding: Float32Array;
    if (usable) {
      embedding = ex.embedding!;
    } else {
      embedding = await embedder.embed(ex.prompt);
      store?.saveEmbedding(ex.id, embedding, embedder.model, embedder.dimension);
    }
    embedded.push({
      id: ex.id,
      prompt: ex.prompt,
      tier: ex.tier,
      source: "user",
      embedding,
      model: embedder.model,
    });
  }

  return mergeByPrompt(embedded);
}

/**
 * Collapse examples with equivalent prompt content to one entry, keeping the
 * highest-priority source (user over seed). Equivalence ignores surrounding
 * whitespace and case so a relabel matches its seed.
 */
function mergeByPrompt(examples: EmbeddedExample[]): EmbeddedExample[] {
  const byKey = new Map<string, EmbeddedExample>();
  for (const ex of examples) {
    const key = ex.prompt.trim().toLowerCase().replace(/\s+/g, " ");
    const existing = byKey.get(key);
    if (!existing || PRIORITY[ex.source] >= PRIORITY[existing.source]) {
      byKey.set(key, ex);
    }
  }
  return [...byKey.values()];
}
