import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { config } from "../core/config.js";
import { getDatabase } from "../core/db.js";
import { loadSkills } from "../skills/skills.js";
import { chunkText } from "./chunker.js";
import type { ContextChunk, ContextSourceType } from "./types.js";

export interface WorkspaceIndexStats {
  indexedChunks: number;
  indexedSkills: number;
  indexedMemoryChunks: number;
  lastIndexedAt: string | null;
}

const INDEX_TABLE = "workspace_fts";
const META_TABLE = "workspace_index_meta";

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export class WorkspaceIndex {
  private workspacePath: string;

  constructor(workspacePath?: string) {
    this.workspacePath = workspacePath || config.workspacePath;
    this.ensureTables();
  }

  private ensureTables(): void {
    const db = getDatabase();
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${INDEX_TABLE} USING fts5(
        chunk_id UNINDEXED,
        source_type,
        source_name,
        content,
        content_hash UNINDEXED
      );

      CREATE TABLE IF NOT EXISTS ${META_TABLE} (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  private setMeta(key: string, value: string): void {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO ${META_TABLE} (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    stmt.run(key, value);
  }

  private getMeta(key: string): string | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT value FROM ${META_TABLE} WHERE key = ?`).get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  clearIndex(): void {
    const db = getDatabase();
    db.exec(`DELETE FROM ${INDEX_TABLE}`);
  }

  indexWorkspace(): WorkspaceIndexStats {
    this.ensureTables();
    this.clearIndex();

    const db = getDatabase();
    const insert = db.prepare(`
      INSERT INTO ${INDEX_TABLE} (chunk_id, source_type, source_name, content, content_hash)
      VALUES (@chunk_id, @source_type, @source_name, @content, @content_hash)
    `);

    let indexedChunks = 0;
    let indexedSkills = 0;
    let indexedMemoryChunks = 0;

    const skills = loadSkills(this.workspacePath).skills.filter((skill) => skill.enabled);
    for (const skill of skills) {
      const header = `Skill: ${skill.name}\n${skill.description || ""}`.trim();
      const body = header ? `${header}\n\n${skill.instructions}` : skill.instructions;
      const chunks = chunkText(body);
      if (chunks.length > 0) {
        indexedSkills += 1;
      }
      chunks.forEach((content, index) => {
        insert.run({
          chunk_id: `skill:${skill.name}:${index}`,
          source_type: "skill",
          source_name: skill.name,
          content,
          content_hash: hashContent(content)
        });
        indexedChunks += 1;
      });
    }

    const memoryChunks = this.indexMemoryFiles(insert);
    indexedMemoryChunks = memoryChunks;
    indexedChunks += memoryChunks;

    const lastIndexedAt = new Date().toISOString();
    this.setMeta("last_indexed_at", lastIndexedAt);
    this.setMeta("indexed_chunks", String(indexedChunks));
    this.setMeta("indexed_skills", String(indexedSkills));
    this.setMeta("indexed_memory_chunks", String(indexedMemoryChunks));

    return {
      indexedChunks,
      indexedSkills,
      indexedMemoryChunks,
      lastIndexedAt
    };
  }

  private indexMemoryFiles(insert: ReturnType<ReturnType<typeof getDatabase>["prepare"]>): number {
    let indexed = 0;

    const memoryFiles: Array<{ name: string; content: string }> = [];
    const memoryPath = join(this.workspacePath, "MEMORY.md");
    if (existsSync(memoryPath)) {
      memoryFiles.push({ name: "MEMORY.md", content: readFileSync(memoryPath, "utf-8") });
    }

    const memoryDir = join(this.workspacePath, "memory");
    if (existsSync(memoryDir)) {
      for (const entry of readdirSync(memoryDir)) {
        if (!entry.endsWith(".md")) continue;
        const filePath = join(memoryDir, entry);
        if (existsSync(filePath)) {
          memoryFiles.push({ name: `memory/${entry}`, content: readFileSync(filePath, "utf-8") });
        }
      }
    }

    for (const file of memoryFiles) {
      const chunks = chunkText(file.content);
      chunks.forEach((content, index) => {
        insert.run({
          chunk_id: `memory:${file.name}:${index}`,
          source_type: "memory",
          source_name: file.name,
          content,
          content_hash: hashContent(content)
        });
        indexed += 1;
      });
    }

    return indexed;
  }

  searchKeyword(query: string, limit = 20): ContextChunk[] {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const db = getDatabase();
    const rows = db.prepare(`
      SELECT chunk_id, source_type, source_name, content, content_hash, bm25(${INDEX_TABLE}) as score
      FROM ${INDEX_TABLE}
      WHERE ${INDEX_TABLE} MATCH ?
      ORDER BY score
      LIMIT ?
    `).all(trimmed, limit) as Array<{
      chunk_id: string;
      source_type: ContextSourceType;
      source_name: string;
      content: string;
      content_hash: string;
      score: number;
    }>;

    return rows.map((row) => ({
      id: row.chunk_id,
      sourceType: row.source_type,
      sourceName: row.source_name,
      content: row.content,
      contentHash: row.content_hash
    }));
  }

  getChunksByIds(ids: string[]): ContextChunk[] {
    if (ids.length === 0) return [];

    const db = getDatabase();
    const placeholders = ids.map(() => "?").join(", ");
    const rows = db.prepare(`
      SELECT chunk_id, source_type, source_name, content, content_hash
      FROM ${INDEX_TABLE}
      WHERE chunk_id IN (${placeholders})
    `).all(...ids) as Array<{
      chunk_id: string;
      source_type: ContextSourceType;
      source_name: string;
      content: string;
      content_hash: string;
    }>;

    return rows.map((row) => ({
      id: row.chunk_id,
      sourceType: row.source_type,
      sourceName: row.source_name,
      content: row.content,
      contentHash: row.content_hash
    }));
  }

  getAllChunks(): ContextChunk[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT chunk_id, source_type, source_name, content, content_hash
      FROM ${INDEX_TABLE}
    `).all() as Array<{
      chunk_id: string;
      source_type: ContextSourceType;
      source_name: string;
      content: string;
      content_hash: string;
    }>;

    return rows.map((row) => ({
      id: row.chunk_id,
      sourceType: row.source_type,
      sourceName: row.source_name,
      content: row.content,
      contentHash: row.content_hash
    }));
  }

  getStats(): WorkspaceIndexStats {
    return {
      indexedChunks: Number(this.getMeta("indexed_chunks") || 0),
      indexedSkills: Number(this.getMeta("indexed_skills") || 0),
      indexedMemoryChunks: Number(this.getMeta("indexed_memory_chunks") || 0),
      lastIndexedAt: this.getMeta("last_indexed_at")
    };
  }
}

let globalWorkspaceIndex: WorkspaceIndex | null = null;

export function getWorkspaceIndex(): WorkspaceIndex {
  if (!globalWorkspaceIndex) {
    globalWorkspaceIndex = new WorkspaceIndex();
  }
  return globalWorkspaceIndex;
}

export function resetWorkspaceIndex(): void {
  globalWorkspaceIndex = null;
}
