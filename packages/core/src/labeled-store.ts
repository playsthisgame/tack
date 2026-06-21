import { Database } from "bun:sqlite";
import type { LabeledExample, Tier } from "./types";

/** A user-labeled example as stored, with any cached embedding and its provenance. */
export interface StoredLabeledExample extends LabeledExample {
  /** Cached vector, if one has been computed and persisted. */
  embedding?: Float32Array;
  /** The embedding model the cached vector was produced with. */
  model?: string;
  /** The cached vector's dimension. */
  dimension?: number;
}

/**
 * Read/cache access to the user's own labeled examples. The loader reads `all()`,
 * embeds anything missing or stale, and writes the vector back via `saveEmbedding`
 * so the work is done once. Abstracted so the SQLite backing can be swapped, like
 * the rest of Tack's persistence seams.
 */
export interface LabeledExampleStore {
  /** Every user-labeled example, with any cached embedding/model/dimension. */
  all(): StoredLabeledExample[];
  /** Persist a freshly computed embedding for `id`, tagged with its model/dimension. */
  saveEmbedding(id: string, embedding: Float32Array, model: string, dimension: number): void;
}

/**
 * SQLite-backed user labeled-example store, living in the same `bun:sqlite` log DB
 * as routing decisions. Embeddings are cached as BLOBs tagged with their model and
 * dimension, so the loader can detect and recompute cross-model vectors rather than
 * compare incompatible shapes.
 */
export class SqliteLabeledExampleStore implements LabeledExampleStore {
  private readonly db: Database;

  constructor(pathOrDb: string | Database) {
    this.db = typeof pathOrDb === "string" ? new Database(pathOrDb) : pathOrDb;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS labeled_examples (
        id         TEXT PRIMARY KEY,
        prompt     TEXT    NOT NULL,
        tier       TEXT    NOT NULL,
        embedding  BLOB,
        model      TEXT,
        dimension  INTEGER
      );
    `);
  }

  /** Insert (or replace) a user label. Embeddings are filled in lazily by the loader. */
  add(id: string, prompt: string, tier: Tier): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO labeled_examples (id, prompt, tier, embedding, model, dimension)
         VALUES ($id, $prompt, $tier, NULL, NULL, NULL)`,
      )
      .run({ $id: id, $prompt: prompt, $tier: tier });
  }

  all(): StoredLabeledExample[] {
    const rows = this.db
      .query("SELECT id, prompt, tier, embedding, model, dimension FROM labeled_examples")
      .all() as {
      id: string;
      prompt: string;
      tier: Tier;
      embedding: Uint8Array | null;
      model: string | null;
      dimension: number | null;
    }[];

    return rows.map((r) => ({
      id: r.id,
      prompt: r.prompt,
      tier: r.tier,
      source: "user" as const,
      embedding: r.embedding ? bytesToFloat32(r.embedding) : undefined,
      model: r.model ?? undefined,
      dimension: r.dimension ?? undefined,
    }));
  }

  saveEmbedding(id: string, embedding: Float32Array, model: string, dimension: number): void {
    this.db
      .query(
        `UPDATE labeled_examples
         SET embedding = $embedding, model = $model, dimension = $dimension
         WHERE id = $id`,
      )
      .run({
        $id: id,
        $embedding: new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength),
        $model: model,
        $dimension: dimension,
      });
  }
}

/** Decode a stored BLOB back into a `Float32Array`, copying to guarantee 4-byte alignment. */
function bytesToFloat32(bytes: Uint8Array): Float32Array {
  const copy = new Uint8Array(bytes); // own, aligned buffer
  return new Float32Array(copy.buffer);
}
