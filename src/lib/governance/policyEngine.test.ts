import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { initDatabase, resetDatabase } from '../core/db.js';
import { evaluatePolicy } from './policyEngine.js';
import { upsertPolicy } from '../policy/policyStore.js';

// Use a dedicated subdir so we don't remove .test-db/tool-tokens when running in parallel
const TEST_DB_DIR = join(process.cwd(), '.test-db', 'policy-engine');
const TEST_DB_PATH = join(TEST_DB_DIR, 'policy-engine.db');
process.env.CLASPER_DB_PATH = TEST_DB_PATH;

beforeEach(() => {
  if (!existsSync(TEST_DB_DIR)) {
    mkdirSync(TEST_DB_DIR, { recursive: true });
  }
  resetDatabase();
  initDatabase();
});

afterEach(() => {
  resetDatabase();
  if (existsSync(TEST_DB_DIR)) {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  }
});

describe('Policy engine', () => {
  it('allows by default when no policy matches', () => {
    const result = evaluatePolicy({ tool: 'filesystem.write', tenant_id: 't1' });
    expect(result.decision).toBe('allow');
  });

  it('allows when a matching rule exists', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'allow_fs_write',
        scope: { tenant_id: 't1' },
        subject: { type: 'tool', name: 'filesystem.write' },
        effect: { decision: 'allow' },
      },
    });
    const result = evaluatePolicy({ tool: 'filesystem.write', tenant_id: 't1' });
    expect(result.decision).toBe('allow');
    expect(result.matched_policies).toContain('allow_fs_write');
  });

  it('requires approval when rule demands it', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'prod_fs_write',
        scope: { tenant_id: 't1', environment: 'prod' },
        subject: { type: 'tool', name: 'filesystem.write' },
        effect: { decision: 'require_approval' },
      },
    });
    const result = evaluatePolicy({
      environment: 'prod',
      tool: 'filesystem.write',
      tenant_id: 't1',
    });
    expect(result.decision).toBe('require_approval');
  });
});
