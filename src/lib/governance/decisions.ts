import { v7 as uuidv7 } from 'uuid';
import { getDatabase } from '../core/db.js';

export type DecisionStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'allow' | 'deny';

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
  created_at: string;
  updated_at: string;
}

function enforceDecisionRowCap(): void {
  const raw = process.env.CLASPER_DECISION_MAX_ROWS;
  const parsed = raw ? Number.parseInt(raw, 10) : 100000;
  const maxRows = Number.isFinite(parsed) ? parsed : 100000;
  if (!Number.isFinite(maxRows) || maxRows <= 0) return;
  const db = getDatabase();
  const row = db.prepare('SELECT COUNT(*) AS count FROM decisions').get() as { count?: number } | undefined;
  const count = row?.count ?? 0;
  if (count <= maxRows) return;
  const overflow = count - maxRows;
  db.prepare(
    `
      DELETE FROM decisions
      WHERE decision_id IN (
        SELECT decision_id
        FROM decisions
        ORDER BY created_at ASC, decision_id ASC
        LIMIT ?
      )
    `
  ).run(overflow);
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

  enforceDecisionRowCap();

  return getDecision(decisionId)!;
}

/**
 * Record a decision for allow or deny (immediate decisions).
 * Creates a Decision Record for every governance decision — enables deterministic replay and audit.
 */
export function recordDecision(params: {
  tenantId: string;
  workspaceId: string;
  executionId: string;
  adapterId: string;
  status: 'allow' | 'deny';
  requestSnapshot: Record<string, unknown>;
  grantedScope?: Record<string, unknown>;
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
    params.status,
    null,
    null,
    JSON.stringify(params.requestSnapshot),
    JSON.stringify(params.grantedScope || {}),
    null,
    now,
    now
  );

  enforceDecisionRowCap();

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
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `
    )
    .all(...values, limit, offset) as DecisionRow[];

  return rows.map(rowToRecord);
}

export function listDecisions(params: {
  tenantId: string;
  workspaceId?: string;
  status: DecisionStatus;
  limit?: number;
  offset?: number;
}): DecisionRecord[] {
  const db = getDatabase();
  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;

  const conditions = ['tenant_id = ?', 'status = ?'];
  const values: unknown[] = [params.tenantId, params.status];
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
      ORDER BY created_at DESC, decision_id DESC
      LIMIT ? OFFSET ?
    `
    )
    .all(...values, limit, offset) as DecisionRow[];

  return rows.map(rowToRecord);
}

export function listAdapterDecisions(params: {
  tenantId: string;
  workspaceId: string;
  adapterId: string;
  status?: DecisionStatus;
  tool?: string;
  decision?: 'allow' | 'deny' | 'require_approval' | 'pending';
  policy?: string;
  since?: string;
  limit?: number;
  offset?: number;
}): DecisionRecord[] {
  const db = getDatabase();
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const conditions = ['tenant_id = ?', 'workspace_id = ?', 'adapter_id = ?'];
  const values: unknown[] = [params.tenantId, params.workspaceId, params.adapterId];

  if (params.status) {
    conditions.push('status = ?');
    values.push(params.status);
  }
  if (params.since) {
    conditions.push('created_at >= ?');
    values.push(params.since);
  }
  if (params.tool) {
    conditions.push(
      `(json_extract(request_snapshot, '$.request.tool') = ? OR json_extract(request_snapshot, '$.request.requested_capabilities[0]') = ?)`
    );
    values.push(params.tool, params.tool);
  }
  if (params.decision) {
    if (params.decision === 'pending') {
      conditions.push(`status = 'pending'`);
    } else {
      conditions.push(
        `(json_extract(request_snapshot, '$.decision.decision') = ? OR status = ?)`
      );
      values.push(params.decision, params.decision);
    }
  }
  if (params.policy) {
    conditions.push(`json_extract(request_snapshot, '$.decision.matched_policies[0]') = ?`);
    values.push(params.policy);
  }

  const whereClause = conditions.join(' AND ');
  const rows = db
    .prepare(
      `
      SELECT * FROM decisions
      WHERE ${whereClause}
      ORDER BY created_at DESC, decision_id DESC
      LIMIT ? OFFSET ?
    `
    )
    .all(...values, limit, offset) as DecisionRow[];

  return rows.map(rowToRecord);
}

/**
 * Get the most recent decision for a specific execution (used for adapter retry/resume).
 */
export function getLatestDecisionForExecution(params: {
  tenantId: string;
  workspaceId: string;
  adapterId: string;
  executionId: string;
}): DecisionRecord | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `
      SELECT * FROM decisions
      WHERE tenant_id = ?
        AND workspace_id = ?
        AND adapter_id = ?
        AND execution_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `
    )
    .get(params.tenantId, params.workspaceId, params.adapterId, params.executionId) as DecisionRow | undefined;

  return row ? rowToRecord(row) : null;
}

export function resolveDecision(params: {
  decisionId: string;
  status: DecisionStatus;
  resolution: Record<string, unknown>;
}): DecisionRecord | null {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      UPDATE decisions
      SET status = ?, resolution = ?, updated_at = ?
      WHERE decision_id = ?
    `
    )
    .run(
      params.status,
      JSON.stringify(params.resolution),
      now,
      params.decisionId
    );

  if (result.changes === 0) return null;
  return getDecision(params.decisionId);
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
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
