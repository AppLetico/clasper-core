/**
 * Audit Log (self-attested)
 *
 * Local, append-only audit entries stored in SQLite.
 * No external proof or signing is produced in OSS.
 */

import { getDatabase } from '../core/db.js';

export type AuditEventType =
  | 'agent_execution_started'
  | 'agent_execution_completed'
  | 'agent_execution_failed'
  | 'tool_call_requested'
  | 'tool_call_succeeded'
  | 'tool_call_failed'
  | 'tool_permission_denied'
  | 'tool_authorization_requested'
  | 'tool_authorization_granted'
  | 'tool_authorization_denied'
  | 'skill_published'
  | 'skill_test_run'
  | 'skill_state_changed'
  | 'skill_deprecated_used'
  | 'budget_warning'
  | 'budget_exceeded'
  | 'workspace_change'
  | 'auth_success'
  | 'auth_failure'
  | 'rate_limit_exceeded'
  | 'config_change'
  | 'system_startup'
  | 'system_shutdown'
  | 'ops_override_used'
  | 'adapter_trace_ingested'
  | 'adapter_audit_event'
  | 'adapter_cost_ingested'
  | 'adapter_metrics_ingested'
  | 'adapter_violation_reported'
  | 'policy_decision_pending'
  | 'policy_decision_resolved'
  | 'approval_auto_allowed_in_core';

export interface AuditEntry {
  id: number;
  tenantId: string;
  workspaceId?: string;
  traceId?: string;
  userId?: string;
  eventType: AuditEventType;
  eventData: Record<string, unknown>;
  createdAt: string;
}

export interface AuditQueryOptions {
  tenantId: string;
  workspaceId?: string;
  traceId?: string;
  userId?: string;
  eventType?: AuditEventType;
  eventTypes?: AuditEventType[];
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface AuditQueryResult {
  entries: AuditEntry[];
  total: number;
  hasMore: boolean;
}

export interface AuditStats {
  totalEntries: number;
  entriesByType: Record<string, number>;
  oldestEntry?: string;
  newestEntry?: string;
}

export class AuditLog {
  log(
    eventType: AuditEventType,
    data: {
      tenantId: string;
      workspaceId?: string;
      traceId?: string;
      userId?: string;
      eventData?: Record<string, unknown>;
    }
  ): number {
    const db = getDatabase();
    const createdAt = new Date().toISOString();
    const eventData = data.eventData || {};

    const stmt = db.prepare(`
      INSERT INTO audit_log (
        tenant_id, workspace_id, trace_id, user_id, event_type, event_data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.tenantId,
      data.workspaceId || null,
      data.traceId || null,
      data.userId || null,
      eventType,
      JSON.stringify(eventData),
      createdAt
    );

    return result.lastInsertRowid as number;
  }

  query(options: AuditQueryOptions): AuditQueryResult {
    const db = getDatabase();
    const conditions: string[] = ['tenant_id = ?'];
    const values: unknown[] = [options.tenantId];

    if (options.workspaceId) {
      conditions.push('workspace_id = ?');
      values.push(options.workspaceId);
    }
    if (options.traceId) {
      conditions.push('trace_id = ?');
      values.push(options.traceId);
    }
    if (options.userId) {
      conditions.push('user_id = ?');
      values.push(options.userId);
    }
    if (options.eventType) {
      conditions.push('event_type = ?');
      values.push(options.eventType);
    } else if (options.eventTypes?.length) {
      conditions.push(`event_type IN (${options.eventTypes.map(() => '?').join(', ')})`);
      values.push(...options.eventTypes);
    }
    if (options.startDate) {
      conditions.push('created_at >= ?');
      values.push(options.startDate);
    }
    if (options.endDate) {
      conditions.push('created_at <= ?');
      values.push(options.endDate);
    }

    const whereClause = conditions.join(' AND ');
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    const rows = db
      .prepare(
        `
        SELECT * FROM audit_log
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(...values, limit, offset) as AuditLogRow[];

    const total = db
      .prepare(`SELECT COUNT(*) as count FROM audit_log WHERE ${whereClause}`)
      .get(...values) as { count: number };

    const entries = rows.map(rowToEntry);
    return {
      entries,
      total: total.count,
      hasMore: offset + limit < total.count,
    };
  }

  stats(tenantId: string): AuditStats {
    const db = getDatabase();
    const rows = db
      .prepare(
        `
        SELECT event_type as eventType, COUNT(*) as count
        FROM audit_log
        WHERE tenant_id = ?
        GROUP BY event_type
      `
      )
      .all(tenantId) as { eventType: string; count: number }[];

    const totalRow = db
      .prepare(`SELECT COUNT(*) as count FROM audit_log WHERE tenant_id = ?`)
      .get(tenantId) as { count: number };

    const oldest = db
      .prepare(`SELECT created_at as createdAt FROM audit_log WHERE tenant_id = ? ORDER BY created_at ASC LIMIT 1`)
      .get(tenantId) as { createdAt?: string } | undefined;

    const newest = db
      .prepare(`SELECT created_at as createdAt FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(tenantId) as { createdAt?: string } | undefined;

    return {
      totalEntries: totalRow.count,
      entriesByType: rows.reduce<Record<string, number>>((acc, row) => {
        acc[row.eventType] = row.count;
        return acc;
      }, {}),
      oldestEntry: oldest?.createdAt,
      newestEntry: newest?.createdAt,
    };
  }

  getStats(tenantId: string, startDate?: string, endDate?: string): AuditStats {
    const db = getDatabase();
    const conditions: string[] = ['tenant_id = ?'];
    const values: unknown[] = [tenantId];
    if (startDate) {
      conditions.push('created_at >= ?');
      values.push(startDate);
    }
    if (endDate) {
      conditions.push('created_at <= ?');
      values.push(endDate);
    }
    const whereClause = conditions.join(' AND ');
    const rows = db
      .prepare(
        `
        SELECT event_type as eventType, COUNT(*) as count
        FROM audit_log
        WHERE ${whereClause}
        GROUP BY event_type
      `
      )
      .all(...values) as { eventType: string; count: number }[];

    const totalRow = db
      .prepare(`SELECT COUNT(*) as count FROM audit_log WHERE ${whereClause}`)
      .get(...values) as { count: number };

    const oldest = db
      .prepare(`SELECT created_at as createdAt FROM audit_log WHERE ${whereClause} ORDER BY created_at ASC LIMIT 1`)
      .get(...values) as { createdAt?: string } | undefined;

    const newest = db
      .prepare(`SELECT created_at as createdAt FROM audit_log WHERE ${whereClause} ORDER BY created_at DESC LIMIT 1`)
      .get(...values) as { createdAt?: string } | undefined;

    return {
      totalEntries: totalRow.count,
      entriesByType: rows.reduce<Record<string, number>>((acc, row) => {
        acc[row.eventType] = row.count;
        return acc;
      }, {}),
      oldestEntry: oldest?.createdAt,
      newestEntry: newest?.createdAt,
    };
  }
}

interface AuditLogRow {
  id: number;
  tenant_id: string;
  workspace_id: string | null;
  trace_id: string | null;
  user_id: string | null;
  event_type: AuditEventType;
  event_data: string;
  created_at: string;
}

function rowToEntry(row: AuditLogRow): AuditEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id || undefined,
    traceId: row.trace_id || undefined,
    userId: row.user_id || undefined,
    eventType: row.event_type,
    eventData: row.event_data ? JSON.parse(row.event_data) : {},
    createdAt: row.created_at,
  };
}

let auditLogInstance: AuditLog | null = null;

export function getAuditLog(): AuditLog {
  if (!auditLogInstance) {
    auditLogInstance = new AuditLog();
  }
  return auditLogInstance;
}

export function auditLog(
  eventType: AuditEventType,
  data: {
    tenantId: string;
    workspaceId?: string;
    traceId?: string;
    userId?: string;
    eventData?: Record<string, unknown>;
  }
): number {
  return getAuditLog().log(eventType, data);
}

export function logOverrideUsed(params: {
  tenantId: string;
  workspaceId?: string;
  traceId?: string;
  userId?: string;
  reasonCode: string;
  justification?: string;
}): number {
  return auditLog('ops_override_used', {
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    traceId: params.traceId,
    userId: params.userId,
    eventData: {
      reason_code: params.reasonCode,
      justification: params.justification || null,
    },
  });
}

/**
 * Log when Core (OSS) auto-allows an execution that would otherwise require approval.
 * Used when CLASPER_REQUIRE_APPROVAL_IN_CORE=allow (default) so the agent is not stuck with no way to approve.
 */
export function logApprovalAutoAllowedInCore(params: {
  tenantId: string;
  workspaceId?: string;
  executionId: string;
  reason: 'policy_requires_approval' | 'risk_requires_approval';
}): number {
  return auditLog('approval_auto_allowed_in_core', {
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    eventData: {
      execution_id: params.executionId,
      reason: params.reason,
    },
  });
}
