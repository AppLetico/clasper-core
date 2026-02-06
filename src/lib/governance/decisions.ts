import { v7 as uuidv7 } from 'uuid';
import { getDatabase } from '../core/db.js';

export type DecisionStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface DecisionRecord {
  decision_id: string;
  tenant_id: string;
  workspace_id: string;
  execution_id: string;
  adapter_id: string;
  status: DecisionStatus;
  required_role?: string | null;
  expires_at?: string | null;
  request_snapshot?: Record<string, unknown> | null;
  granted_scope?: Record<string, unknown> | null;
  resolution?: Record<string, unknown> | null;
  callback_url?: string | null;
  decision_token?: string | null;
  decision_token_jti?: string | null;
  decision_token_used_at?: string | null;
  created_at: string;
  updated_at: string;
}

export function createDecision(params: {
  tenantId: string;
  workspaceId: string;
  executionId: string;
  adapterId: string;
  requiredRole?: string;
  expiresAt?: string;
  requestSnapshot?: Record<string, unknown>;
  grantedScope?: Record<string, unknown>;
  callbackUrl?: string;
}): DecisionRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const decisionId = uuidv7();

  db.prepare(
    `
    INSERT INTO decisions (
      decision_id, tenant_id, workspace_id, execution_id, adapter_id,
      status, required_role, expires_at, request_snapshot, granted_scope,
      callback_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    decisionId,
    params.tenantId,
    params.workspaceId,
    params.executionId,
    params.adapterId,
    'pending',
    params.requiredRole || null,
    params.expiresAt || null,
    JSON.stringify(params.requestSnapshot || {}),
    JSON.stringify(params.grantedScope || {}),
    params.callbackUrl || null,
    now,
    now
  );

  return getDecision(decisionId)!;
}

export function getDecision(decisionId: string): DecisionRecord | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM decisions WHERE decision_id = ?')
    .get(decisionId) as DecisionRow | undefined;

  return row ? rowToRecord(row) : null;
}

export function listPendingDecisions(params: {
  tenantId: string;
  workspaceId?: string;
  limit?: number;
  offset?: number;
}): DecisionRecord[] {
  const db = getDatabase();
  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;

  const conditions = ['tenant_id = ?', 'status = ?'];
  const values: unknown[] = [params.tenantId, 'pending'];
  if (params.workspaceId) {
    conditions.push('workspace_id = ?');
    values.push(params.workspaceId);
  }

  const whereClause = conditions.join(' AND ');
  const rows = db
    .prepare(
      `
      SELECT * FROM decisions
      WHERE ${whereClause}
      ORDER BY created_at ASC
      LIMIT ? OFFSET ?
    `
    )
    .all(...values, limit, offset) as DecisionRow[];

  return rows.map(rowToRecord);
}

export function resolveDecision(params: {
  decisionId: string;
  status: DecisionStatus;
  resolution: Record<string, unknown>;
  decisionToken?: string;
  decisionTokenJti?: string;
}): DecisionRecord | null {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      UPDATE decisions
      SET status = ?, resolution = ?, decision_token = ?, decision_token_jti = ?, updated_at = ?
      WHERE decision_id = ?
    `
    )
    .run(
      params.status,
      JSON.stringify(params.resolution),
      params.decisionToken || null,
      params.decisionTokenJti || null,
      now,
      params.decisionId
    );

  if (result.changes === 0) return null;
  return getDecision(params.decisionId);
}

export function markDecisionTokenUsed(params: {
  decisionId: string;
  decisionTokenJti: string;
}): boolean {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      UPDATE decisions
      SET decision_token_used_at = ?, updated_at = ?
      WHERE decision_id = ? AND decision_token_jti = ? AND decision_token_used_at IS NULL
    `
    )
    .run(now, now, params.decisionId, params.decisionTokenJti);

  return result.changes > 0;
}

interface DecisionRow {
  decision_id: string;
  tenant_id: string;
  workspace_id: string;
  execution_id: string;
  adapter_id: string;
  status: DecisionStatus;
  required_role: string | null;
  expires_at: string | null;
  request_snapshot: string | null;
  granted_scope: string | null;
  resolution: string | null;
  callback_url: string | null;
  decision_token: string | null;
  decision_token_jti: string | null;
  decision_token_used_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: DecisionRow): DecisionRecord {
  return {
    decision_id: row.decision_id,
    tenant_id: row.tenant_id,
    workspace_id: row.workspace_id,
    execution_id: row.execution_id,
    adapter_id: row.adapter_id,
    status: row.status,
    required_role: row.required_role,
    expires_at: row.expires_at,
    request_snapshot: row.request_snapshot ? JSON.parse(row.request_snapshot) : null,
    granted_scope: row.granted_scope ? JSON.parse(row.granted_scope) : null,
    resolution: row.resolution ? JSON.parse(row.resolution) : null,
    callback_url: row.callback_url,
    decision_token: row.decision_token,
    decision_token_jti: row.decision_token_jti,
    decision_token_used_at: row.decision_token_used_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
