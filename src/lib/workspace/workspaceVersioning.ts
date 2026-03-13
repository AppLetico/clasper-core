/**
 * Workspace Versioning
 *
 * Track workspace changes with content-addressable storage.
 * Features:
 * - Snapshot current workspace state
 * - Content-addressable storage (SHA256)
 * - Diff between versions
 * - Rollback support
 */

import { createHash } from 'crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { getDatabase } from '../core/db.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A snapshot of a single file
 */
export interface FileSnapshot {
  path: string;
  hash: string;
  size: number;
  content?: string;
}

/**
 * A complete workspace version
 */
export interface WorkspaceVersion {
  hash: string;
  workspaceId: string;
  files: FileSnapshot[];
  message?: string;
  createdAt: string;
}

/**
 * Diff between two file snapshots
 */
export interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'unchanged';
  oldHash?: string;
  newHash?: string;
  oldSize?: number;
  newSize?: number;
}

/**
 * Diff between two workspace versions
 */
export interface WorkspaceDiff {
  oldHash: string;
  newHash: string;
  files: FileDiff[];
  summary: {
    added: number;
    modified: number;
    deleted: number;
    unchanged: number;
  };
}

// ============================================================================
// Workspace Versioning Class
// ============================================================================

export class WorkspaceVersioning {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Capture current workspace state as a version
   */
  snapshot(workspaceId: string, message?: string): WorkspaceVersion {
    const files = this.scanWorkspace();
    const hash = this.calculateVersionHash(files);
    const createdAt = new Date().toISOString();

    const version: WorkspaceVersion = {
      hash,
      workspaceId,
      files,
      message,
      createdAt,
    };

    // Store in database
    this.saveVersion(version);

    return version;
  }

  /**
   * Get a specific version by hash
   */
  getVersion(hash: string): WorkspaceVersion | null {
    const db = getDatabase();

    const row = db
      .prepare('SELECT * FROM workspace_versions WHERE hash = ?')
      .get(hash) as VersionRow | undefined;

    if (!row) return null;

    return this.rowToVersion(row);
  }

  /**
   * List all versions for a workspace
   */
  listVersions(
    workspaceId: string,
    options?: { limit?: number; offset?: number }
  ): { versions: WorkspaceVersion[]; total: number } {
    const db = getDatabase();
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    const countRow = db
      .prepare('SELECT COUNT(*) as count FROM workspace_versions WHERE workspace_id = ?')
      .get(workspaceId) as { count: number };

    const rows = db
      .prepare(
        `
        SELECT * FROM workspace_versions
        WHERE workspace_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(workspaceId, limit, offset) as VersionRow[];

    return {
      versions: rows.map((row) => this.rowToVersion(row)),
      total: countRow.count,
    };
  }

  /**
   * Get the latest version for a workspace
   */
  getLatestVersion(workspaceId: string): WorkspaceVersion | null {
    const db = getDatabase();

    const row = db
      .prepare(
        `
        SELECT * FROM workspace_versions
        WHERE workspace_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `
      )
      .get(workspaceId) as VersionRow | undefined;

    if (!row) return null;

    return this.rowToVersion(row);
  }

  /**
   * Diff two versions
   */
  diff(oldHash: string, newHash: string): WorkspaceDiff {
    const oldVersion = this.getVersion(oldHash);
    const newVersion = this.getVersion(newHash);

    if (!oldVersion || !newVersion) {
      throw new Error('One or both versions not found');
    }

    return this.compareVersions(oldVersion, newVersion);
  }

  /**
   * Diff current workspace against a version
   */
  diffFromCurrent(versionHash: string, workspaceId: string): WorkspaceDiff {
    const oldVersion = this.getVersion(versionHash);
    if (!oldVersion) {
      throw new Error('Version not found');
    }

    const currentFiles = this.scanWorkspace();
    const currentHash = this.calculateVersionHash(currentFiles);

    const currentVersion: WorkspaceVersion = {
      hash: currentHash,
      workspaceId,
      files: currentFiles,
      createdAt: new Date().toISOString(),
    };

    return this.compareVersions(oldVersion, currentVersion);
  }

  /**
   * Check if workspace has changed since a version
   */
  hasChanges(versionHash: string): boolean {
    const version = this.getVersion(versionHash);
    if (!version) return true;

    const currentFiles = this.scanWorkspace();
    const currentHash = this.calculateVersionHash(currentFiles);

    return currentHash !== versionHash;
  }

  /**
   * Rollback workspace to a previous version
   * Note: This actually modifies files on disk
   */
  rollback(versionHash: string): void {
    const version = this.getVersion(versionHash);
    if (!version) {
      throw new Error('Version not found');
    }

    // For each file in the version, restore it
    for (const file of version.files) {
      if (file.content) {
        const fullPath = join(this.workspacePath, file.path);
        writeFileSync(fullPath, file.content, 'utf-8');
      }
    }
  }

  /**
   * Delete old versions beyond a retention limit
   */
  pruneVersions(workspaceId: string, keepCount: number): number {
    const db = getDatabase();

    // Get versions to delete
    const toDelete = db
      .prepare(
        `
        SELECT hash FROM workspace_versions
        WHERE workspace_id = ?
        ORDER BY created_at DESC
        LIMIT -1 OFFSET ?
      `
      )
      .all(workspaceId, keepCount) as { hash: string }[];

    if (toDelete.length === 0) return 0;

    const hashes = toDelete.map((r) => r.hash);
    const placeholders = hashes.map(() => '?').join(', ');

    const result = db
      .prepare(`DELETE FROM workspace_versions WHERE hash IN (${placeholders})`)
      .run(...hashes);

    return result.changes;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Scan workspace directory for files
   */
  private scanWorkspace(): FileSnapshot[] {
    const files: FileSnapshot[] = [];
    this.scanDirectory(this.workspacePath, files);
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Recursively scan a directory
   */
  private scanDirectory(dir: string, files: FileSnapshot[]): void {
    if (!existsSync(dir)) return;

    const entries = readdirSync(dir);

    for (const entry of entries) {
      // Skip hidden files and common ignore patterns
      if (entry.startsWith('.') || entry === 'node_modules') {
        continue;
      }

      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        this.scanDirectory(fullPath, files);
      } else if (stat.isFile()) {
        const relativePath = relative(this.workspacePath, fullPath);
        const content = readFileSync(fullPath, 'utf-8');
        const hash = this.hashContent(content);

        files.push({
          path: relativePath,
          hash,
          size: stat.size,
          content,
        });
      }
    }
  }

  /**
   * Calculate hash for a single file's content
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Calculate hash for entire version (based on file hashes)
   */
  private calculateVersionHash(files: FileSnapshot[]): string {
    const combined = files
      .map((f) => `${f.path}:${f.hash}`)
      .join('\n');
    return createHash('sha256').update(combined).digest('hex').slice(0, 16);
  }

  /**
   * Save version to database
   */
  private saveVersion(version: WorkspaceVersion): void {
    const db = getDatabase();

    // Store files without content for space efficiency
    const filesWithoutContent = version.files.map((f) => ({
      path: f.path,
      hash: f.hash,
      size: f.size,
    }));

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO workspace_versions (
        hash, workspace_id, files, message, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      version.hash,
      version.workspaceId,
      JSON.stringify(filesWithoutContent),
      version.message || null,
      version.createdAt
    );
  }

  /**
   * Compare two versions and generate diff
   */
  private compareVersions(
    oldVersion: WorkspaceVersion,
    newVersion: WorkspaceVersion
  ): WorkspaceDiff {
    const oldFiles = new Map(oldVersion.files.map((f) => [f.path, f]));
    const newFiles = new Map(newVersion.files.map((f) => [f.path, f]));
    const allPaths = new Set([...oldFiles.keys(), ...newFiles.keys()]);

    const fileDiffs: FileDiff[] = [];
    let added = 0, modified = 0, deleted = 0, unchanged = 0;

    for (const path of allPaths) {
      const oldFile = oldFiles.get(path);
      const newFile = newFiles.get(path);

      if (!oldFile && newFile) {
        fileDiffs.push({
          path,
          status: 'added',
          newHash: newFile.hash,
          newSize: newFile.size,
        });
        added++;
      } else if (oldFile && !newFile) {
        fileDiffs.push({
          path,
          status: 'deleted',
          oldHash: oldFile.hash,
          oldSize: oldFile.size,
        });
        deleted++;
      } else if (oldFile && newFile) {
        if (oldFile.hash !== newFile.hash) {
          fileDiffs.push({
            path,
            status: 'modified',
            oldHash: oldFile.hash,
            newHash: newFile.hash,
            oldSize: oldFile.size,
            newSize: newFile.size,
          });
          modified++;
        } else {
          fileDiffs.push({
            path,
            status: 'unchanged',
            oldHash: oldFile.hash,
            newHash: newFile.hash,
          });
          unchanged++;
        }
      }
    }

    return {
      oldHash: oldVersion.hash,
      newHash: newVersion.hash,
      files: fileDiffs,
      summary: { added, modified, deleted, unchanged },
    };
  }

  /**
   * Convert database row to WorkspaceVersion
   */
  private rowToVersion(row: VersionRow): WorkspaceVersion {
    return {
      hash: row.hash,
      workspaceId: row.workspace_id,
      files: JSON.parse(row.files),
      message: row.message || undefined,
      createdAt: row.created_at,
    };
  }
}

// ============================================================================
// Database Row Type
// ============================================================================

interface VersionRow {
  hash: string;
  workspace_id: string;
  files: string;
  message: string | null;
  created_at: string;
}

// ============================================================================
// Factory Function
// ============================================================================

const versioningInstances = new Map<string, WorkspaceVersioning>();

/**
 * Get or create a WorkspaceVersioning instance for a path
 */
export function getWorkspaceVersioning(workspacePath: string): WorkspaceVersioning {
  if (!versioningInstances.has(workspacePath)) {
    versioningInstances.set(workspacePath, new WorkspaceVersioning(workspacePath));
  }
  return versioningInstances.get(workspacePath)!;
}

/**
 * Reset all versioning instances (for testing)
 */
export function resetWorkspaceVersioning(): void {
  versioningInstances.clear();
}
