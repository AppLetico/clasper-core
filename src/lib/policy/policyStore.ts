import { getDatabase } from '../core/db.js';
import { PolicySchema, type PolicyObject } from './policySchema.js';

export interface PolicyRecord extends PolicyObject {
  tenant_id: string;
  workspace_id?: string | null;
  environment?: string | null;
  precedence: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export function upsertPolicy(params: {
  tenantId: string;
  policy: PolicyObject;
}): PolicyRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const parsed = PolicySchema.parse(params.policy);
  const scope = parsed.scope || {};
  const precedence = parsed.precedence ?? 0;
  const enabled = parsed.enabled ?? true;

  const record = {
    ...parsed,
    scope: {
      ...scope,
      tenant_id: scope.tenant_id || params.tenantId,
    },
    precedence,
    enabled,
  };

  db.prepare(
    `
      INSERT INTO policies (
        tenant_id, policy_id, workspace_id, environment, precedence, enabled,
        policy_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, policy_id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        environment = excluded.environment,
        precedence = excluded.precedence,
        enabled = excluded.enabled,
        policy_json = excluded.policy_json,
        updated_at = excluded.updated_at
    `
  ).run(
    record.scope?.tenant_id || params.tenantId,
    record.policy_id,
    record.scope?.workspace_id || null,
    record.scope?.environment || null,
    precedence,
    enabled ? 1 : 0,
    JSON.stringify(record),
    now,
    now
  );

  return getPolicy(params.tenantId, record.policy_id)!;
}

export function getPolicy(tenantId: string, policyId: string): PolicyRecord | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `
      SELECT * FROM policies
      WHERE tenant_id = ? AND policy_id = ?
    `
    )
    .get(tenantId, policyId) as PolicyRow | undefined;

  return row ? rowToRecord(row) : null;
}

export function listPolicies(params: {
  tenantId: string;
  workspaceId?: string;
  environment?: string;
  enabled?: boolean;
}): PolicyRecord[] {
  const db = getDatabase();
  const conditions: string[] = ['tenant_id = ?'];
  const values: unknown[] = [params.tenantId];

  if (params.workspaceId) {
    conditions.push('(workspace_id = ? OR workspace_id IS NULL)');
    values.push(params.workspaceId);
  }
  if (params.environment) {
    conditions.push('(environment = ? OR environment IS NULL)');
    values.push(params.environment);
  }
  if (params.enabled !== undefined) {
    conditions.push('enabled = ?');
    values.push(params.enabled ? 1 : 0);
  }

  const whereClause = conditions.join(' AND ');

  const rows = db
    .prepare(
      `
      SELECT * FROM policies
      WHERE ${whereClause}
      ORDER BY precedence DESC, updated_at DESC
    `
    )
    .all(...values) as PolicyRow[];

  return rows.map(rowToRecord);
}

export function setPolicyEnabled(params: {
  tenantId: string;
  policyId: string;
  enabled: boolean;
}): PolicyRecord | null {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      UPDATE policies
      SET enabled = ?, updated_at = ?
      WHERE tenant_id = ? AND policy_id = ?
    `
    )
    .run(params.enabled ? 1 : 0, now, params.tenantId, params.policyId);

  if (result.changes === 0) return null;
  return getPolicy(params.tenantId, params.policyId);
}

export function deletePolicy(params: {
  tenantId: string;
  policyId: string;
}): boolean {
  const db = getDatabase();
  const result = db
    .prepare(
      `
      DELETE FROM policies
      WHERE tenant_id = ? AND policy_id = ?
    `
    )
    .run(params.tenantId, params.policyId);

  return result.changes > 0;
}

interface PolicyRow {
  tenant_id: string;
  policy_id: string;
  workspace_id: string | null;
  environment: string | null;
  precedence: number;
  enabled: number;
  policy_json: string;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: PolicyRow): PolicyRecord {
  const parsed = PolicySchema.parse(JSON.parse(row.policy_json));
  return {
    ...parsed,
    tenant_id: row.tenant_id,
    workspace_id: row.workspace_id,
    environment: row.environment,
    precedence: row.precedence,
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
