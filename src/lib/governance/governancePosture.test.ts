import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, resetDatabase } from '../core/db.js';
import { upsertPolicy } from '../policy/policyStore.js';
import { computePosture } from './governancePosture.js';

beforeEach(() => {
  process.env.CLASPER_DB_PATH = ':memory:';
  resetDatabase();
  initDatabase();
});

afterEach(() => {
  resetDatabase();
  delete process.env.CLASPER_DB_PATH;
});

describe('governancePosture', () => {
  it('returns posture with fallback when fallback policy exists', () => {
    upsertPolicy({
      tenantId: 'local',
      policy: {
        policy_id: 'fallback',
        subject: { type: 'tool' },
        effect: { decision: 'require_approval' },
        precedence: -100,
        enabled: true,
      },
    });
    const result = computePosture({
      tenant_id: 'local',
      workspace_id: 'local',
      adapter_id: 'openclaw-local',
    });
    expect(result.fallback_present).toBe(true);
    expect(result.fallback_enabled).toBe(true);
    expect(result.adapter).toBe('openclaw-local');
    expect(result.policy_count).toBe(1);
    expect(typeof result.engine_version).toBe('string');
    expect(result.engine_version.length).toBeGreaterThan(0);
    expect(['permissive', 'guarded', 'strict']).toContain(result.mode);
    expect(['ENFORCED', 'DEGRADED', 'DISABLED']).toContain(result.status);
    expect(Array.isArray(result.covered_tools)).toBe(true);
    expect(Array.isArray(result.uncovered_tools)).toBe(true);
  });

  it('returns fallback_present false when no fallback policy', () => {
    upsertPolicy({
      tenantId: 'local',
      policy: {
        policy_id: 'allow-read',
        subject: { type: 'tool', name: 'read' },
        effect: { decision: 'allow' },
        enabled: true,
      },
    });
    const result = computePosture({
      tenant_id: 'local',
      workspace_id: 'local',
      adapter_id: 'openclaw-local',
    });
    expect(result.fallback_present).toBe(false);
  });
});
