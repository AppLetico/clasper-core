import { getDatabase } from "../core/db.js";

export interface RecordToolAuthorizationParams {
  tenant_id: string;
  adapter_id: string;
  execution_id: string;
  tool: string;
  tool_group?: string | null;
  decision: "allow" | "deny";
  policy_id?: string | null;
  reason?: string | null;
  granted_scope?: Record<string, unknown> | object | null;
}

/**
 * Record a tool authorization decision for the Tool Registry.
 * Used by both /api/governance/tool/authorize and /api/execution/request flows.
 */
export function recordToolAuthorization(params: RecordToolAuthorizationParams): void {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO tool_authorizations (
      tenant_id, adapter_id, execution_id, tool, tool_group, decision, policy_id, reason, granted_scope, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    params.tenant_id,
    params.adapter_id,
    params.execution_id,
    params.tool,
    params.tool_group ?? null,
    params.decision,
    params.policy_id ?? null,
    params.reason ?? null,
    params.decision === "allow" ? JSON.stringify(params.granted_scope ?? {}) : null,
    null
  );
}

export interface ToolRegistryEntry {
  name: string;
  tool_group: string | null;
  auth_count: number;
  allow_count: number;
  deny_count: number;
  /** Allow rate as a value between 0 and 1 (derived from decisions over time). */
  allow_rate: number;
  adapters: string[];
  last_used: string | null;
}

/**
 * List distinct tools that have at least one authorization for the tenant
 * (Tool Registry for Ops Console).
 *
 * Shows known authority surfaces with allow/block rates, NOT static permissions.
 * Tools are governed per-invocation, not pre-authorized.
 */
export function listToolRegistry(tenantId: string): ToolRegistryEntry[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
      SELECT tool AS name,
             MAX(tool_group) AS tool_group,
             COUNT(*) AS auth_count,
             SUM(CASE WHEN decision = 'allow' THEN 1 ELSE 0 END) as allow_count,
             SUM(CASE WHEN decision = 'deny' THEN 1 ELSE 0 END) as deny_count,
             GROUP_CONCAT(DISTINCT adapter_id) as adapters,
             MAX(created_at) AS last_used
      FROM tool_authorizations
      WHERE tenant_id = ?
      GROUP BY tool
      ORDER BY last_used DESC, name ASC
    `
    )
    .all(tenantId) as {
      name: string;
      tool_group: string | null;
      auth_count: number;
      allow_count: number;
      deny_count: number;
      adapters: string;
      last_used: string | null;
    }[];

  return rows.map((r) => ({
    name: r.name,
    tool_group: r.tool_group,
    auth_count: r.auth_count,
    allow_count: r.allow_count,
    deny_count: r.deny_count,
    allow_rate: r.auth_count > 0 ? r.allow_count / r.auth_count : 0,
    adapters: r.adapters ? r.adapters.split(',') : [],
    last_used: r.last_used,
  }));
}

export interface ToolUsageHistory {
  id: number;
  tenant_id: string;
  adapter_id: string;
  execution_id: string;
  tool: string;
  decision: string;
  policy_id: string | null;
  reason: string | null;
  granted_scope: any;
  expires_at: string | null;
  created_at: string;
}

/**
 * Get detailed usage history for a specific tool.
 */
export function getToolDetails(tenantId: string, toolName: string): ToolUsageHistory[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
      SELECT *
      FROM tool_authorizations
      WHERE tenant_id = ? AND tool = ?
      ORDER BY created_at DESC
      LIMIT 20
    `
    )
    .all(tenantId, toolName) as ToolUsageHistory[];
    
  // Parse JSON fields
  return rows.map(r => ({
    ...r,
    granted_scope: typeof r.granted_scope === 'string' ? JSON.parse(r.granted_scope) : r.granted_scope
  }));
}
