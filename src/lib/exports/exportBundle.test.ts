import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { dirname } from 'path';
import { initDatabase, resetDatabase } from '../core/db.js';

const TEST_DB_PATH = `${process.cwd()}/.test-db/export-bundle.db`;

beforeEach(() => {
  process.env.CLASPER_DB_PATH = TEST_DB_PATH;
  process.env.CLASPER_EXPORT_SIGNING_MODE = 'off';
  if (!existsSync(dirname(TEST_DB_PATH))) {
    mkdirSync(dirname(TEST_DB_PATH), { recursive: true });
  }
  initDatabase();
});

afterEach(() => {
  resetDatabase();
  if (existsSync(dirname(TEST_DB_PATH))) {
    rmSync(dirname(TEST_DB_PATH), { recursive: true, force: true });
  }
});

describe('export bundle', () => {
  it('builds and verifies a bundle', async () => {
    const { createExportBundle } = await import('./exportBundle.js');
    const { verifyExportBundle } = await import('./verifyBundle.js');
    const result = await createExportBundle({ tenantId: 't1' });
    const verification = await verifyExportBundle(result.bundlePath);
    expect(verification.ok).toBe(true);
  });
});
