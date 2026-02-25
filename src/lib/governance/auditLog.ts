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
  | 'policy_fallback_hit'
  | 'policy_created_from_trace'
  | 'policy_created_via_wizard'
  | 'policy_updated_via_wizard'
  | 'policy_exception_hit'
  | 'policy_exception_miss'
  | 'approval_grant_created'
  | 'approval_grant_consumed'
  | 'approval_auto_allowed_in_core';

export interface WizardAuditMeta {
  wizard_meta_version: number;
  created_via_wizard: boolean;
  selected_outcome: "allow" | "require_approval" | "deny";
  scope_choice: "workspace" | "custom_path_scope" | "global";
  command_match_choice: "single" | "list" | "none";
  warnings_shown: string[];
  wizard_acknowledged_allow: boolean;
  wizard_meta_invalid: boolean;
  wizard_meta_attested: boolean;
  attested_by: "core";
  attested_at: string;
  actor_user_id: string | null;
  tenant_id: string;
  workspace_id: string | null;
  edited_via_wizard?: boolean;
  last_edited_at?: string;
  last_edited_by?: string | null;
}

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
      approval_mode: 'simulate',
      approval_source: 'config_override',
    },
  });
}

/**
 * Log when an adapter hits a "fallback" policy (i.e. the only matched policy).
 * Useful for detecting new / unscoped tool surfaces and tightening policy coverage.
 */
export function logPolicyFallbackHit(params: {
  tenantId: string;
  workspaceId?: string;
  executionId: string;
  adapterId: string;
  tool?: string;
  toolGroup?: string;
  policyId: string;
  decision: 'allow' | 'deny' | 'require_approval';
}): number {
  return auditLog('policy_fallback_hit', {
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    eventData: {
      execution_id: params.executionId,
      adapter_id: params.adapterId,
      tool: params.tool ?? null,
      tool_group: params.toolGroup ?? null,
      policy_id: params.policyId,
      decision: params.decision,
    },
  });
}

/**
 * Log when a policy was created from the "Create policy from this trace" Ops UI flow.
 */
export function logPolicyCreatedFromTrace(params: {
  tenantId: string;
  workspaceId?: string;
  policyId: string;
  sourceTraceId?: string;
  tool?: string;
  decision: string;
  precedence?: number;
  adapterId?: string;
  wizardMeta?: WizardAuditMeta;
  policySummary?: Record<string, unknown>;
  wizardMetaHash?: string;
}): number {
  return auditLog('policy_created_from_trace', {
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    traceId: params.sourceTraceId,
    eventData: {
      policy_id: params.policyId,
      source_trace_id: params.sourceTraceId ?? null,
      tool: params.tool ?? null,
      decision: params.decision,
      precedence: params.precedence ?? null,
      adapter_id: params.adapterId ?? null,
      wizard_meta: params.wizardMeta ?? null,
      policy_summary: params.policySummary ?? null,
      wizard_meta_hash: params.wizardMetaHash ?? null,
    },
  });
}

export function logPolicyCreatedViaWizard(params: {
  tenantId: string;
  workspaceId?: string;
  sourceTraceId?: string;
  policyId: string;
  tool?: string;
  decision: string;
  precedence?: number;
  adapterId?: string;
  wizardMeta: WizardAuditMeta;
  policySummary?: Record<string, unknown>;
  wizardMetaHash?: string;
}): number {
  return auditLog('policy_created_via_wizard', {
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    traceId: params.sourceTraceId,
    eventData: {
      policy_id: params.policyId,
      source_trace_id: params.sourceTraceId ?? null,
      tool: params.tool ?? null,
      decision: params.decision,
      precedence: params.precedence ?? null,
      adapter_id: params.adapterId ?? null,
      wizard_meta: params.wizardMeta,
      policy_summary: params.policySummary ?? null,
      wizard_meta_hash: params.wizardMetaHash ?? null,
      attested_by: "core",
    },
  });
}

export function logPolicyUpdatedViaWizard(params: {
  tenantId: string;
  workspaceId?: string;
  sourceTraceId?: string;
  policyId: string;
  tool?: string;
  decision: string;
  precedence?: number;
  adapterId?: string;
  actorUserId?: string;
  wizardMeta: WizardAuditMeta;
  wizardMetaHash?: string;
  policySummaryBefore?: Record<string, unknown>;
  policySummaryAfter?: Record<string, unknown>;
  policySummaryBeforeHash?: string;
  policySummaryAfterHash?: string;
  diffHint?: string[];
}): number {
  return auditLog('policy_updated_via_wizard', {
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    traceId: params.sourceTraceId,
    userId: params.actorUserId,
    eventData: {
      policy_id: params.policyId,
      source_trace_id: params.sourceTraceId ?? null,
      tool: params.tool ?? null,
      decision: params.decision,
      precedence: params.precedence ?? null,
      adapter_id: params.adapterId ?? null,
      wizard_meta: params.wizardMeta,
      wizard_meta_hash: params.wizardMetaHash ?? null,
      policy_summary_before: params.policySummaryBefore ?? null,
      policy_summary_after: params.policySummaryAfter ?? null,
      policy_summary_before_hash: params.policySummaryBeforeHash ?? null,
      policy_summary_after_hash: params.policySummaryAfterHash ?? null,
      diff_hint: params.diffHint ?? [],
      attested_by: "core",
    },
  });
}

export function logPolicyExceptionHit(params: {
  tenantId: string;
  workspaceId?: string;
  executionId: string;
  policyId: string;
  operator?: string;
  contextSnapshot?: Record<string, unknown>;
}): number {
  return auditLog('policy_exception_hit', {
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    eventData: {
      execution_id: params.executionId,
      policy_id: params.policyId,
      operator: params.operator ?? null,
      context_snapshot: params.contextSnapshot ?? {},
    },
  });
}

export function logPolicyExceptionMiss(params: {
  tenantId: string;
  workspaceId?: string;
  executionId: string;
  policyId: string;
  operator?: string;
  contextSnapshot?: Record<string, unknown>;
}): number {
  return auditLog('policy_exception_miss', {
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    eventData: {
      execution_id: params.executionId,
      policy_id: params.policyId,
      operator: params.operator ?? null,
      context_snapshot: params.contextSnapshot ?? {},
    },
  });
}

export function logApprovalGrantCreated(params: {
  tenantId: string;
  workspaceId?: string;
  executionId: string;
  policyId?: string;
  contextSnapshot?: Record<string, unknown>;
}): number {
  return auditLog('approval_grant_created', {
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    eventData: {
      execution_id: params.executionId,
      policy_id: params.policyId ?? null,
      context_snapshot: params.contextSnapshot ?? {},
    },
  });
}

export function logApprovalGrantConsumed(params: {
  tenantId: string;
  workspaceId?: string;
  executionId: string;
  policyId?: string;
  contextSnapshot?: Record<string, unknown>;
}): number {
  return auditLog('approval_grant_consumed', {
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    eventData: {
      execution_id: params.executionId,
      policy_id: params.policyId ?? null,
      context_snapshot: params.contextSnapshot ?? {},
    },
  });
}
