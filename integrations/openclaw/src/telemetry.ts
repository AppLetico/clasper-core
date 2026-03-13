/**
 * Telemetry reporting — outcome ingestion to Clasper Core.
 *
 * Telemetry is always non-fatal: governance was already enforced at decision time.
 * Failures here are logged but never block execution.
 */

import type { ClasperClient } from './clasperClient.js';
import type { OpenClawTool, ExecutionDecision } from './types.js';

// ---------------------------------------------------------------------------
// Report interfaces
// ---------------------------------------------------------------------------

export interface BlockedReport {
  executionId: string;
  traceId: string;
  adapterId: string;
  tenantId: string;
  workspaceId: string;
  tool: OpenClawTool;
  decision: ExecutionDecision;
}

export interface ExecutedReport {
  executionId: string;
  traceId: string;
  adapterId: string;
  tenantId: string;
  workspaceId: string;
  tool: OpenClawTool;
  durationMs: number;
  costUsd?: number;
  model?: string;
  provider?: string;
}

// ---------------------------------------------------------------------------
// Report: blocked
// ---------------------------------------------------------------------------

/**
 * Report a blocked tool invocation to Clasper Core's audit log.
 */
export async function reportBlocked(
  client: ClasperClient,
  report: BlockedReport
): Promise<void> {
  await client.ingestAudit({
    tenant_id: report.tenantId,
    workspace_id: report.workspaceId,
    execution_id: report.executionId,
    trace_id: report.traceId,
    adapter_id: report.adapterId,
    event_type: 'tool_execution_blocked',
    message: `Tool "${report.tool.name}" blocked by governance policy`,
    event_data: {
      tool: report.tool.name,
      tool_group: report.tool.group ?? null,
      blocked_reason: report.decision.blocked_reason ?? 'policy_denied',
      decision_id: report.decision.decision_id ?? null,
      matched_policies: report.decision.matched_policies ?? [],
      explanation: report.decision.explanation ?? null,
    },
    occurred_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Report: executed
// ---------------------------------------------------------------------------

/**
 * Report a successfully executed tool invocation to Clasper Core
 * (audit event + cost metric if applicable).
 */
export async function reportExecuted(
  client: ClasperClient,
  report: ExecutedReport
): Promise<void> {
  // Audit event
  await client.ingestAudit({
    tenant_id: report.tenantId,
    workspace_id: report.workspaceId,
    execution_id: report.executionId,
    trace_id: report.traceId,
    adapter_id: report.adapterId,
    event_type: 'tool_execution_completed',
    message: `Tool "${report.tool.name}" executed successfully`,
    event_data: {
      tool: report.tool.name,
      tool_group: report.tool.group ?? null,
      duration_ms: report.durationMs,
    },
    occurred_at: new Date().toISOString(),
  });

  // Cost metric (if available)
  if (report.costUsd !== undefined && report.costUsd > 0) {
    await client.ingestCost({
      tenant_id: report.tenantId,
      workspace_id: report.workspaceId,
      execution_id: report.executionId,
      trace_id: report.traceId,
      adapter_id: report.adapterId,
      cost_usd: report.costUsd,
      model: report.model,
      provider: report.provider,
      recorded_at: new Date().toISOString(),
    });
  }
}
