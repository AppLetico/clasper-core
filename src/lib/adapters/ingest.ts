import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { getDatabase } from '../core/db.js';
import { AgentTraceSchema } from '../tracing/trace.js';
import type { AgentTrace, TraceStep } from '../tracing/trace.js';
import { getTraceStore } from '../tracing/traceStore.js';
import { verifyTraceIntegrity } from '../tracing/traceIntegrity.js';
import { resolveTrustStatus } from '../tracing/trustStatus.js';
import { auditLog } from '../governance/auditLog.js';
import { getBudgetManager } from '../governance/budgetManager.js';
import {
  AuditEventIngestSchema,
  CostMetricIngestSchema,
  ExecutionMetricsIngestSchema,
  TraceIngestSchema,
  ViolationReportSchema,
  type AuditEventIngest,
  type CostMetricIngest,
  type ExecutionMetricsIngest,
  type TraceIngest,
  type ViolationReport,
} from './telemetryContract.js';

export interface IngestResult {
  status: 'ok' | 'duplicate';
}

export function ingestTrace(payload: unknown): IngestResult {
  const parsed = TraceIngestSchema.parse(payload);
  if (isDuplicate(parsed.execution_id, 'trace')) {
    return { status: 'duplicate' };
  }

  const trace = AgentTraceSchema.parse(parsed.trace);

  if (
    trace.id !== parsed.trace_id ||
    trace.tenantId !== parsed.tenant_id ||
    trace.workspaceId !== parsed.workspace_id
  ) {
    throw new Error('Trace identity mismatch for ingest payload');
  }

  trace.adapter_id = parsed.adapter_id;
  // Persist execution_id for governance joins (no schema migration).
  // This is the adapter contract execution identifier carried by the telemetry envelope.
  trace.labels = {
    ...(trace.labels || {}),
    execution_id: parsed.execution_id,
  };
  const violations = trace.violations || [];

  if (violations.length > 0) {
    trace.violations = violations;
  }
  const integrity = verifyTraceIntegrity(trace);
  trace.integrity_status = integrity.status;
  trace.integrity_failures = integrity.failures;
  trace.integrity_checked_at = new Date().toISOString();
  trace.trust_status = resolveTrustStatus(trace);
  getTraceStore().save(trace);

  auditLog('adapter_trace_ingested', {
    tenantId: parsed.tenant_id,
    workspaceId: parsed.workspace_id,
    traceId: parsed.trace_id,
    userId: `adapter:${parsed.adapter_id}`,
    eventData: {
      adapter_id: parsed.adapter_id,
      execution_id: parsed.execution_id,
    },
  });

  return { status: 'ok' };
}

export function ingestAudit(payload: unknown): IngestResult {
  const parsed = AuditEventIngestSchema.parse(payload);
  if (isDuplicate(parsed.execution_id, `audit:${parsed.event_type}`)) {
    return { status: 'duplicate' };
  }

  writeAdapterAudit(parsed);
  return { status: 'ok' };
}

export function ingestCost(payload: unknown): IngestResult {
  const parsed = CostMetricIngestSchema.parse(payload);
  if (isDuplicate(parsed.execution_id, 'cost')) {
    return { status: 'duplicate' };
  }

  const budgetManager = getBudgetManager();
  budgetManager.recordSpend(parsed.tenant_id, parsed.cost_usd, {
    traceId: parsed.trace_id,
    description: `adapter:${parsed.adapter_id}`,
  });

  auditLog('adapter_cost_ingested', {
    tenantId: parsed.tenant_id,
    workspaceId: parsed.workspace_id,
    traceId: parsed.trace_id,
    userId: `adapter:${parsed.adapter_id}`,
    eventData: {
      adapter_id: parsed.adapter_id,
      execution_id: parsed.execution_id,
      cost_usd: parsed.cost_usd,
      input_tokens: parsed.input_tokens,
      output_tokens: parsed.output_tokens,
      model: parsed.model,
      provider: parsed.provider,
      recorded_at: parsed.recorded_at,
    },
  });

  return { status: 'ok' };
}

export function ingestMetrics(payload: unknown): IngestResult {
  const parsed = ExecutionMetricsIngestSchema.parse(payload);
  if (isDuplicate(parsed.execution_id, 'metrics')) {
    return { status: 'duplicate' };
  }

  auditLog('adapter_metrics_ingested', {
    tenantId: parsed.tenant_id,
    workspaceId: parsed.workspace_id,
    traceId: parsed.trace_id,
    userId: `adapter:${parsed.adapter_id}`,
    eventData: {
      adapter_id: parsed.adapter_id,
      execution_id: parsed.execution_id,
      step_count: parsed.step_count,
      duration_ms: parsed.duration_ms,
      recorded_at: parsed.recorded_at,
    },
  });

  return { status: 'ok' };
}

export function ingestViolation(payload: unknown): IngestResult {
  const parsed = ViolationReportSchema.parse(payload);
  if (isDuplicate(parsed.execution_id, `violation:${parsed.violation_type}`)) {
    return { status: 'duplicate' };
  }

  auditLog('adapter_violation_reported', {
    tenantId: parsed.tenant_id,
    workspaceId: parsed.workspace_id,
    traceId: parsed.trace_id,
    userId: `adapter:${parsed.adapter_id}`,
    eventData: {
      adapter_id: parsed.adapter_id,
      execution_id: parsed.execution_id,
      violation_type: parsed.violation_type,
      message: parsed.message,
      occurred_at: parsed.occurred_at,
      data: parsed.data,
    },
  });

  return { status: 'ok' };
}

/**
 * Payload shape for recording a blocked execution (minimal fields from execution request).
 */
export interface BlockedExecutionPayload {
  tenant_id: string;
  workspace_id: string;
  adapter_id: string;
  tool?: string;
  tool_group?: string;
  execution_id?: string;
  requested_capabilities?: string[];
}

/**
 * Record a trace for an execution that was blocked (403 or policy deny).
 * So blocked attempts appear in the Ops Console Traces UI.
 */
export function recordBlockedExecutionTrace(
  payload: BlockedExecutionPayload,
  reason: string
): void {
  const executionId = payload.execution_id ?? uuidv7();
  const traceId = uuidv7();
  const now = new Date().toISOString();
  const toolName = payload.tool ?? 'unknown';

  const steps: TraceStep[] = [
    {
      type: 'tool_call',
      timestamp: now,
      durationMs: 0,
      data: {
        toolCallId: executionId,
        toolName,
        arguments: {},
        permitted: false,
      },
    },
    {
      type: 'error',
      timestamp: now,
      durationMs: 0,
      data: {
        code: 'blocked',
        message: reason,
        recoverable: false,
      },
    },
  ];

  const trace: AgentTrace = {
    id: traceId,
    tenantId: payload.tenant_id,
    workspaceId: payload.workspace_id,
    agentRole: undefined,
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    model: 'clasper',
    provider: 'clasper',
    skillVersions: {},
    input: { message: toolName, messageHistory: 0 },
    steps,
    usage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
    error: reason,
    labels: { execution_id: executionId },
    adapter_id: payload.adapter_id,
    integrity_status: 'unverified',
    trust_status: 'unverified',
  };

  (trace as { risk_level?: string }).risk_level = 'high';

  getTraceStore().save(trace);

  auditLog('blocked_execution_trace_recorded', {
    tenantId: payload.tenant_id,
    workspaceId: payload.workspace_id,
    traceId,
    userId: `adapter:${payload.adapter_id}`,
    eventData: {
      adapter_id: payload.adapter_id,
      execution_id: executionId,
      tool: payload.tool ?? null,
      reason,
    },
  });
}

function writeAdapterAudit(event: AuditEventIngest): void {
  auditLog('adapter_audit_event', {
    tenantId: event.tenant_id,
    workspaceId: event.workspace_id,
    traceId: event.trace_id,
    userId: `adapter:${event.adapter_id}`,
    eventData: {
      adapter_id: event.adapter_id,
      execution_id: event.execution_id,
      event_type: event.event_type,
      message: event.message,
      event_data: event.event_data,
      occurred_at: event.occurred_at,
    },
  });
}

function isDuplicate(executionId: string, eventType: string): boolean {
  const db = getDatabase();
  const stmt = db.prepare(
    'INSERT INTO ingest_dedup (execution_id, event_type) VALUES (?, ?)'
  );

  try {
    stmt.run(executionId, eventType);
    return false;
  } catch {
    return true;
  }
}
