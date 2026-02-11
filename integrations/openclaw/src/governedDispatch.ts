/**
 * Governed Tool Dispatch — the adapter shim.
 *
 * Intercepts every OpenClaw tool invocation and routes it through
 * Clasper Core's pre-execution decision engine.
 *
 * CRITICAL: Uses explicit effect-based switching (deny / require_approval / allow).
 * The `require_approval` state is a third state — NOT "not allowed."
 * Using `!decision.allowed` would block prematurely on approval-required decisions.
 *
 * Fail-closed: any error from Clasper or unknown decision effect blocks execution.
 */

import { v7 as uuidv7 } from 'uuid';
import type { ClasperClient } from './clasperClient.js';
import type {
  OpenClawTool,
  ToolInvocationContext,
  ToolDispatchInterceptor,
  DecisionEffect,
  LogFn,
} from './types.js';
import { inferIntent } from './intentInference.js';
import { mapToolContext } from './intentInference.js';
import { reportBlocked, reportExecuted } from './telemetry.js';
import { waitForApproval } from './approval.js';
import { normalizeToolName } from './toolNames.js';
import {
  buildRequestFingerprint,
  clearReusableExecutionId,
  getReusableExecutionId,
  setReusableExecutionId,
  type InFlightExecution,
} from './executionReuse.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface GovernedDispatchConfig {
  adapterId: string;
  tenantId: string;
  workspaceId: string;
  log: LogFn;
  approvalWaitTimeoutMs?: number;
  approvalPollIntervalMs?: number;
  executionReuseWindowMs?: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates the tool dispatch interceptor wired to a Clasper client.
 */
export function createGovernedDispatch(
  client: ClasperClient,
  config: GovernedDispatchConfig
): ToolDispatchInterceptor {
  const { adapterId, tenantId, workspaceId, log } = config;
  const approvalWaitTimeoutMs = config.approvalWaitTimeoutMs ?? 300_000;
  const approvalPollIntervalMs = config.approvalPollIntervalMs ?? 2_000;
  const executionReuseWindowMs = config.executionReuseWindowMs ?? 600_000;
  const inFlightByFingerprint = new Map<string, InFlightExecution>();

  return async function governedToolInvoke(
    tool: OpenClawTool,
    args: Record<string, unknown>,
    context: ToolInvocationContext,
    next: (tool: OpenClawTool, args: Record<string, unknown>) => Promise<unknown>
  ): Promise<unknown> {
    const normalizedTool = { ...tool, name: normalizeToolName(tool.name) };
    const toolContext = mapToolContext(normalizedTool, args);
    const fingerprint = buildRequestFingerprint({
      adapterId,
      toolName: normalizedTool.name,
      context: context as Record<string, unknown>,
      params: args,
      mappedTargets: toolContext.targets,
    });
    const nowMs = Date.now();
    const reusedExecutionId = getReusableExecutionId(
      inFlightByFingerprint,
      fingerprint,
      nowMs,
      executionReuseWindowMs
    );
    const executionId = reusedExecutionId ?? uuidv7();
    const traceId = uuidv7();

    // -----------------------------------------------------------------
    // 1. Request decision from Clasper Core
    // -----------------------------------------------------------------
    let decision;
    try {
      decision = await client.requestDecision({
        execution_id: executionId,
        adapter_id: adapterId,
        tenant_id: tenantId,
        workspace_id: workspaceId,
        requested_capabilities: [normalizedTool.name],
        tool: normalizedTool.name,
        tool_group: normalizedTool.group,
        skill: context.skill,
        intent: inferIntent(normalizedTool, args),
        intent_source: 'heuristic',
        context: toolContext,
      });
    } catch (err) {
      // Fail closed: Clasper unreachable → block execution
      log(
        `[clasper] BLOCKED ${tool.name} — Clasper unreachable (fail-closed): ` +
        `${err instanceof Error ? err.message : String(err)}`
      );
      throw new Error(
        `[clasper] Execution blocked: Clasper Core unreachable. ` +
        `Governance requires a live control plane. Tool: ${tool.name}`
      );
    }

    // -----------------------------------------------------------------
    // 2. Resolve effect — explicit three-state switch
    // -----------------------------------------------------------------
    const effect: DecisionEffect =
      decision.decision ?? (decision.allowed ? 'allow' : 'deny');

    switch (effect) {
      case 'deny': {
        clearReusableExecutionId(inFlightByFingerprint, fingerprint);
        log(
          `[clasper] BLOCKED ${tool.name} (decision_id=${decision.decision_id ?? 'n/a'}, ` +
          `reason=${decision.blocked_reason ?? 'policy_denied'})`
        );
        await reportBlocked(client, {
          executionId,
          traceId,
          adapterId,
          tenantId,
          workspaceId,
          tool: normalizedTool,
          decision,
        });
        throw new Error(
          `[clasper] Execution denied by policy: ${decision.blocked_reason ?? 'policy_denied'}`
        );
      }

      case 'require_approval':
      case 'pending': {
        if (!reusedExecutionId) {
          setReusableExecutionId(inFlightByFingerprint, fingerprint, executionId, nowMs);
        }
        if (reusedExecutionId) {
          await client.ingestAudit({
            tenant_id: tenantId,
            workspace_id: workspaceId,
            execution_id: executionId,
            trace_id: traceId,
            adapter_id: adapterId,
            event_type: 'approval_pending_reused',
            message: `Reused pending approval for "${normalizedTool.name}"`,
            event_data: {
              tool: normalizedTool.name,
              execution_reused: true,
              reused_execution_id: executionId,
            },
            occurred_at: new Date().toISOString(),
          });
        }
        log(
          `[clasper] AWAITING APPROVAL for ${tool.name} ` +
          `(decision_id=${decision.decision_id ?? 'n/a'}, reused=${reusedExecutionId ? 'yes' : 'no'})`
        );
        try {
          await waitForApproval(client, executionId, {
            log,
            decisionId: decision.decision_id,
            timeoutMs: approvalWaitTimeoutMs,
            pollIntervalMs: approvalPollIntervalMs,
          });
          clearReusableExecutionId(inFlightByFingerprint, fingerprint);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.toLowerCase().includes('approval denied')) {
            clearReusableExecutionId(inFlightByFingerprint, fingerprint);
          }
          throw err;
        }
        log(
          `[clasper] APPROVED ${tool.name} ` +
          `(decision_id=${decision.decision_id ?? 'n/a'})`
        );
        break;
      }

      case 'allow':
        clearReusableExecutionId(inFlightByFingerprint, fingerprint);
        break;

      default: {
        // Fail closed on unknown effect
        log(`[clasper] BLOCKED ${tool.name} — unknown decision effect: ${effect}`);
        throw new Error(
          `[clasper] Execution blocked: unknown decision effect "${effect}". ` +
          `Fail-closed: only explicit allow/deny/require_approval are valid.`
        );
      }
    }

    // -----------------------------------------------------------------
    // 3. Execute the tool
    // -----------------------------------------------------------------
    const start = Date.now();
    const result = await next(tool, args);
    const durationMs = Date.now() - start;

    log(
      `[clasper] governed ${tool.name} allowed ` +
      `(decision_id=${decision.decision_id ?? 'n/a'}, duration=${durationMs}ms)`
    );

    // -----------------------------------------------------------------
    // 4. Report outcome (non-fatal)
    // -----------------------------------------------------------------
    await reportExecuted(client, {
      executionId,
      traceId,
      adapterId,
      tenantId,
      workspaceId,
      tool: normalizedTool,
      durationMs,
    });

    return result;
  };
}
