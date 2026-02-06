import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { dirname } from 'path';
import { initDatabase, resetDatabase } from '../core/db.js';

const TEST_DB_PATH = `${process.cwd()}/.test-db/decisions.db`;

beforeEach(() => {
  process.env.CLASPER_DB_PATH = TEST_DB_PATH;
  process.env.CLASPER_DECISION_TOKEN_SECRET = 'test-secret';
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

describe('decisions', () => {
  it('issues and consumes decision tokens', async () => {
    const { createDecision, resolveDecision, markDecisionTokenUsed } = await import('./decisions.js');
    const { issueDecisionToken, verifyDecisionToken } = await import('./decisionTokens.js');

    const decision = createDecision({
      tenantId: 't1',
      workspaceId: 'w1',
      executionId: 'exec1',
      adapterId: 'adapter1',
      requiredRole: 'release_manager',
      requestSnapshot: { foo: 'bar' },
      grantedScope: { max_steps: 10 },
    });

    const token = await issueDecisionToken({
      tenant_id: decision.tenant_id,
      workspace_id: decision.workspace_id,
      adapter_id: decision.adapter_id,
      execution_id: decision.execution_id,
      decision_id: decision.decision_id,
      granted_scope: decision.granted_scope || {},
    });

    const resolved = resolveDecision({
      decisionId: decision.decision_id,
      status: 'approved',
      resolution: { action: 'approve' },
      decisionToken: token.token,
      decisionTokenJti: token.jti,
    });

    expect(resolved?.decision_token).toBe(token.token);

    const verified = await verifyDecisionToken(token.token);
    expect(verified.payload.decision_id).toBe(decision.decision_id);

    const consumed = markDecisionTokenUsed({
      decisionId: decision.decision_id,
      decisionTokenJti: token.jti,
    });
    expect(consumed).toBe(true);

    const reused = markDecisionTokenUsed({
      decisionId: decision.decision_id,
      decisionTokenJti: token.jti,
    });
    expect(reused).toBe(false);
  });
});
