import { getDatabase } from "../core/db.js";
import type { ContextSourceType } from "./types.js";

export interface VectorEntry {
  chunkId: string;
  sourceType: ContextSourceType;
  sourceName: string;
  embedding: number[];
  contentHash: string;
}

export interface VectorMatch {
  chunkId: string;
  sourceType: ContextSourceType;
  sourceName: string;
  score: number;
  contentHash: string;
}

const TABLE_NAME = "workspace_embeddings";

function ensureTable(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      chunk_id TEXT PRIMARY KEY,
      source_type TEXT,
      source_name TEXT,
      embedding BLOB,
      content_hash TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_embeddings_source
      ON ${TABLE_NAME}(source_type, source_name);
  `);
}

function toBuffer(values: number[]): Buffer {
  return Buffer.from(new Float32Array(values).buffer);
}

function fromBuffer(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
}

function cosineSimilarity(a: Float32Array, b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class VectorStore {
  constructor() {
    ensureTable();
  }

  upsertEmbeddings(entries: VectorEntry[]): void {
    if (entries.length === 0) return;
    ensureTable();
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO ${TABLE_NAME} (chunk_id, source_type, source_name, embedding, content_hash)
      VALUES (@chunk_id, @source_type, @source_name, @embedding, @content_hash)
      ON CONFLICT(chunk_id) DO UPDATE SET
        source_type = excluded.source_type,
        source_name = excluded.source_name,
        embedding = excluded.embedding,
        content_hash = excluded.content_hash,
        updated_at = datetime('now')
    `);

    const transaction = db.transaction((rows: VectorEntry[]) => {
      for (const entry of rows) {
        stmt.run({
          chunk_id: entry.chunkId,
          source_type: entry.sourceType,
          source_name: entry.sourceName,
          embedding: toBuffer(entry.embedding),
          content_hash: entry.contentHash
        });
      }
    });

    transaction(entries);
  }

  getEmbeddings(): Array<{
    chunkId: string;
    sourceType: ContextSourceType;
    sourceName: string;
    embedding: Buffer;
    contentHash: string;
  }> {
    ensureTable();
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT chunk_id, source_type, source_name, embedding, content_hash
      FROM ${TABLE_NAME}
    `).all() as Array<{
      chunk_id: string;
      source_type: ContextSourceType;
      source_name: string;
      embedding: Buffer;
      content_hash: string;
    }>;
    return rows.map((r) => ({
      chunkId: r.chunk_id,
      sourceType: r.source_type,
      sourceName: r.source_name,
      embedding: r.embedding,
      contentHash: r.content_hash,
    }));
  }

  clear(): void {
    ensureTable();
    const db = getDatabase();
    db.exec(`DELETE FROM ${TABLE_NAME}`);
  }

  deleteByChunkIds(chunkIds: string[]): void {
    if (chunkIds.length === 0) return;
    ensureTable();
    const db = getDatabase();
    const placeholders = chunkIds.map(() => "?").join(", ");
    db.prepare(`DELETE FROM ${TABLE_NAME} WHERE chunk_id IN (${placeholders})`).run(...chunkIds);
  }

  search(queryEmbedding: number[], limit = 20): VectorMatch[] {
    if (queryEmbedding.length === 0) return [];
    const rows = this.getEmbeddings();
    const scored: VectorMatch[] = rows.map((row) => ({
      chunkId: row.chunkId,
      sourceType: row.sourceType,
      sourceName: row.sourceName,
      score: cosineSimilarity(fromBuffer(row.embedding), queryEmbedding),
      contentHash: row.contentHash
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

let globalVectorStore: VectorStore | null = null;

export function getVectorStore(): VectorStore {
  if (!globalVectorStore) {
    globalVectorStore = new VectorStore();
  }
  return globalVectorStore;
}

export function resetVectorStore(): void {
  globalVectorStore = null;
}
