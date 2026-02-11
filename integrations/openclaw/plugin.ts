/**
 * Clasper Governance Plugin for OpenClaw
 *
 * Intercepts every tool invocation in the OpenClaw gateway and routes it
 * through Clasper Core's pre-execution decision engine.
 *
 * Governance principles:
 *  - Pre-execution authority only (no logging-after-the-fact)
 *  - No bypass (if Clasper is unreachable → fail closed)
 *  - Plugin cannot be partially enabled
 */

import type { OpenClawPluginApi } from './src/types.js';
import { randomUUID } from 'node:crypto';
import { ClasperClient } from './src/clasperClient.js';
import { createGovernedDispatch } from './src/governedDispatch.js';
import { inferIntent, mapToolContext } from './src/intentInference.js';
import { waitForApproval } from './src/approval.js';
import { normalizeToolName } from './src/toolNames.js';
import { reportBlocked, reportExecuted } from './src/telemetry.js';
import {
  buildRequestFingerprint,
  clearReusableExecutionId,
  getReusableExecutionId,
  setReusableExecutionId,
  type InFlightExecution,
} from './src/executionReuse.js';

const ADAPTER_VERSION = '0.1.0';

const ADAPTER_CAPABILITIES = [
  'exec',
  'write',
  'delete',
  'web_search',
  'web_fetch',
  'read',
];

type PendingInvocation = {
  executionId: string;
  traceId: string;
  startedAt: string;
  rawToolName: string;
  normalizedToolName: string;
  params: Record<string, unknown>;
};

function parseMs(
  input: unknown,
  fallback: number,
  min: number
): number {
  if (typeof input !== 'number' || Number.isNaN(input)) return fallback;
  return Math.max(min, Math.floor(input));
}

function invocationKey(
  context: Record<string, unknown>,
  rawToolName: string
): string {
  const sessionKey =
    typeof context.sessionKey === 'string'
      ? context.sessionKey
      : typeof context.agentId === 'string'
        ? context.agentId
        : 'unknown-session';
  return `${sessionKey}:${rawToolName}`;
}

function inferToolGroup(toolName: string): string | undefined {
  if (toolName === 'read' || toolName === 'write' || toolName === 'delete' || toolName === 'edit' || toolName === 'apply_patch') {
    return 'fs';
  }
  if (toolName === 'exec' || toolName === 'bash' || toolName === 'process') {
    return 'runtime';
  }
  if (toolName === 'web_search' || toolName === 'web_fetch') {
    return 'web';
  }
  return undefined;
}

function readStringField(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const value = (obj as Record<string, unknown>)[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.toLowerCase() === 'unknown') return undefined;
  return trimmed;
}

function normalizeIntentText(input: string): string {
  // Keep approvals readable and compact.
  return input.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function extractAdapterIntent(
  event: Record<string, unknown>,
  context: Record<string, unknown>
): string | undefined {
  const keys = [
    'intent',
    'intentSummary',
    'intent_summary',
    'goal',
    'task',
    'objective',
    'purpose',
    'reason',
    'instruction',
    'instructions',
    'userPrompt',
    'user_prompt',
    'prompt',
    'message',
    'query',
  ];

  const containers: unknown[] = [
    event,
    event.metadata,
    event.request,
    event.payload,
    event.input,
    context,
    context.metadata,
    context.request,
    context.payload,
    context.input,
    context.turn,
  ];

  for (const container of containers) {
    for (const key of keys) {
      const candidate = readStringField(container, key);
      if (candidate) return normalizeIntentText(candidate);
    }
  }
  return undefined;
}

/**
 * OpenClaw plugin entry point.
 * Called by the gateway when the plugin is loaded.
 */
export async function register(api: OpenClawPluginApi): Promise<void> {
  const log = api.log ?? console.log;
  // OpenClaw provides plugin-scoped settings on api.pluginConfig.
  // Keep a fallback for older API shapes that exposed it on api.config.
  const rawConfig =
    (api.pluginConfig && typeof api.pluginConfig === 'object' ? api.pluginConfig : undefined) ??
    (api.config && typeof api.config === 'object' ? api.config : undefined) ??
    {};
  const config = rawConfig as {
    clasperUrl?: string;
    adapterId?: string;
    adapterSecret?: string;
    approvalWaitTimeoutMs?: number;
    approvalPollIntervalMs?: number;
    executionReuseWindowMs?: number;
  };
  const approvalWaitTimeoutMs = parseMs(config.approvalWaitTimeoutMs, 300_000, 10_000);
  const approvalPollIntervalMs = parseMs(config.approvalPollIntervalMs, 2_000, 250);
  const executionReuseWindowMs = parseMs(config.executionReuseWindowMs, 600_000, 1_000);

  // -------------------------------------------------------------------------
  // 1. Validate configuration
  // -------------------------------------------------------------------------
  if (!config.clasperUrl) {
    log(
      '[clasper] Plugin installed but not activated: clasperUrl is missing. ' +
        'Set openclaw.json → plugins.entries.clasper-openclaw.config.clasperUrl, then restart the gateway.'
    );
    return;
  }

  const adapterId = config.adapterId ?? 'openclaw-local';
  const clasperUrl = config.clasperUrl.replace(/\/+$/, '');
  const isGatewayStart =
    process.argv.slice(2).join(' ').toLowerCase().includes('gateway') &&
    process.argv.slice(2).join(' ').toLowerCase().includes('start');

  log(`[clasper] Initializing governance plugin (adapter=${adapterId}, core=${clasperUrl})`);
  log(
    `[clasper] Approval settings: wait=${approvalWaitTimeoutMs}ms, ` +
      `poll=${approvalPollIntervalMs}ms, reuse_window=${executionReuseWindowMs}ms`
  );

  // -------------------------------------------------------------------------
  // 2. Determine interception capability (legacy interceptor vs hooks API)
  // -------------------------------------------------------------------------
  const hasLegacyInterceptor = typeof api.interceptToolDispatch === 'function';
  const hasHookApi = typeof api.on === 'function';
  if (!hasLegacyInterceptor && !hasHookApi) {
    if (isGatewayStart) {
      throw new Error(
        '[clasper] FATAL: OpenClaw gateway does not expose a supported tool interception API. ' +
        'Upgrade OpenClaw or use a compatible version of this plugin.'
      );
    }
    log(
      '[clasper] Plugin loaded in a non-gateway command context; interception API unavailable. ' +
      'Skipping activation until `openclaw gateway start`.'
    );
    return;
  }

  // -------------------------------------------------------------------------
  // 3. Register adapter with Clasper Core
  // -------------------------------------------------------------------------
  const client = new ClasperClient({
    baseUrl: clasperUrl,
    adapterId,
    tenantId: 'local',
    workspaceId: 'local',
    adapterSecret: config.adapterSecret,
    log,
  });

  try {
    await client.registerAdapter({
      adapter_id: adapterId,
      display_name: 'OpenClaw Local Gateway',
      risk_class: 'high',
      capabilities: ADAPTER_CAPABILITIES,
      version: ADAPTER_VERSION,
      enabled: true,
    });
    log(`[clasper] Adapter registered with Clasper Core (risk_class=high)`);
  } catch (err) {
    throw new Error(
      `[clasper] FATAL: Failed to register adapter with Clasper Core at ${clasperUrl}. ` +
      `Governance cannot be established. Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // -------------------------------------------------------------------------
  // 4. Hook tool dispatch — every tool invocation goes through governance
  // -------------------------------------------------------------------------
  if (hasLegacyInterceptor) {
    const governedDispatch = createGovernedDispatch(client, {
      adapterId,
      tenantId: 'local',
      workspaceId: 'local',
      log,
      approvalWaitTimeoutMs,
      approvalPollIntervalMs,
      executionReuseWindowMs,
    });
    api.interceptToolDispatch!(governedDispatch);
    log(`[clasper] Tool dispatch interceptor installed — all tools are now governed.`);
    log(`[clasper] Plugin ready. No OpenClaw tool with side effects can execute unless Clasper explicitly allows it.`);
    return;
  }

  // OpenClaw 2026.x compatibility path: use lifecycle hooks.
  const pendingByKey = new Map<string, PendingInvocation[]>();
  const inFlightByFingerprint = new Map<string, InFlightExecution>();
  api.on!(
    'before_tool_call',
    async (
      event: Record<string, unknown>,
      context: Record<string, unknown>
    ): Promise<{ block?: boolean; blockReason?: string } | void> => {
      const rawToolName = typeof event.toolName === 'string' ? event.toolName : '';
      const toolName = normalizeToolName(rawToolName);
      const params =
        event.params && typeof event.params === 'object'
          ? (event.params as Record<string, unknown>)
          : {};
      if (!rawToolName) return;

      try {
        const toolGroup = inferToolGroup(toolName);
        const toolContext = mapToolContext({ name: toolName, group: toolGroup }, params);
        const fingerprint = buildRequestFingerprint({
          adapterId,
          toolName,
          context,
          params,
          mappedTargets: toolContext.targets,
        });
        const reusedExecutionId = getReusableExecutionId(
          inFlightByFingerprint,
          fingerprint,
          Date.now(),
          executionReuseWindowMs
        );
        const executionId = reusedExecutionId ?? randomUUID();
        const traceId = randomUUID();
        const adapterIntent = extractAdapterIntent(event, context);
        const heuristicIntent = inferIntent({ name: toolName, group: toolGroup }, params);
        const finalIntent = adapterIntent ?? heuristicIntent;
        const finalIntentSource = adapterIntent ? 'adapter_context' : 'heuristic';
        const decision = await client.requestDecision({
          execution_id: executionId,
          adapter_id: adapterId,
          tenant_id: 'local',
          workspace_id: 'local',
          requested_capabilities: [toolName],
          tool: toolName,
          tool_group: toolGroup,
          intent: finalIntent,
          intent_source: finalIntentSource,
          context: toolContext,
        });

        const effect = decision.decision ?? (decision.allowed ? 'allow' : 'deny');
        if (effect === 'allow') {
          clearReusableExecutionId(inFlightByFingerprint, fingerprint);
          return;
        }
        if (effect === 'deny') {
          clearReusableExecutionId(inFlightByFingerprint, fingerprint);
          const reason = decision.blocked_reason ?? 'policy_denied';
          await reportBlocked(client, {
            executionId,
            traceId,
            adapterId,
            tenantId: 'local',
            workspaceId: 'local',
            tool: { name: toolName },
            decision,
          });
          log(`[clasper] BLOCKED ${rawToolName} (normalized=${toolName}, reason=${reason})`);
          return { block: true, blockReason: `[clasper] denied: ${reason}` };
        }
        // For require_approval/pending, wait for resolution before allowing.
        if (effect === 'require_approval' || effect === 'pending') {
          if (!reusedExecutionId) {
            setReusableExecutionId(
              inFlightByFingerprint,
              fingerprint,
              decision.execution_id,
              Date.now()
            );
          }
          if (reusedExecutionId) {
            await client.ingestAudit({
              tenant_id: 'local',
              workspace_id: 'local',
              execution_id: executionId,
              trace_id: traceId,
              adapter_id: adapterId,
              event_type: 'approval_pending_reused',
              message: `Reused pending approval for "${toolName}"`,
              event_data: {
                tool: toolName,
                execution_reused: true,
                reused_execution_id: executionId,
              },
              occurred_at: new Date().toISOString(),
            });
          }
          log(
            `[clasper] AWAITING APPROVAL for ${rawToolName} ` +
              `(normalized=${toolName}, reused=${reusedExecutionId ? 'yes' : 'no'})`
          );
          try {
            await waitForApproval(client, decision.execution_id, {
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
          log(`[clasper] APPROVED ${rawToolName} (normalized=${toolName})`);
        } else {
          return {
            block: true,
            blockReason: `[clasper] blocked: unknown decision effect "${String(effect)}"`,
          };
        }

        const key = invocationKey(context, rawToolName);
        const queue = pendingByKey.get(key) ?? [];
        queue.push({
          executionId,
          traceId,
          startedAt: new Date().toISOString(),
          rawToolName,
          normalizedToolName: toolName,
          params,
        });
        pendingByKey.set(key, queue);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`[clasper] BLOCKED ${rawToolName} (normalized=${toolName}) — fail-closed: ${message}`);
        return { block: true, blockReason: `[clasper] fail-closed: ${message}` };
      }
    },
    { priority: 100 }
  );

  api.on!(
    'after_tool_call',
    async (event: Record<string, unknown>, context: Record<string, unknown>): Promise<void> => {
      const rawToolName = typeof event.toolName === 'string' ? event.toolName : '';
      if (!rawToolName) return;

      const key = invocationKey(context, rawToolName);
      const queue = pendingByKey.get(key);
      if (!queue || queue.length === 0) return;
      const pending = queue.shift()!;
      if (queue.length === 0) pendingByKey.delete(key);

      const completedAt = new Date().toISOString();
      const durationMs =
        typeof event.durationMs === 'number'
          ? event.durationMs
          : Math.max(0, Date.now() - Date.parse(pending.startedAt));
      const errorText =
        typeof event.error === 'string'
          ? event.error
          : event.error != null
            ? JSON.stringify(event.error)
            : undefined;
      const success = !errorText;

      if (success) {
        await reportExecuted(client, {
          executionId: pending.executionId,
          traceId: pending.traceId,
          adapterId,
          tenantId: 'local',
          workspaceId: 'local',
          tool: { name: pending.normalizedToolName },
          durationMs,
        });
      }

      await client.ingestTrace({
        tenant_id: 'local',
        workspace_id: 'local',
        execution_id: pending.executionId,
        trace_id: pending.traceId,
        adapter_id: adapterId,
        trace: {
          id: pending.traceId,
          tenantId: 'local',
          workspaceId: 'local',
          agentRole: 'openclaw',
          startedAt: pending.startedAt,
          completedAt,
          durationMs,
          skillVersions: {},
          model: 'openclaw',
          provider: 'openclaw',
          input: {
            message: pending.rawToolName,
            messageHistory: 0,
          },
          steps: [
            {
              type: 'tool_call',
              timestamp: pending.startedAt,
              durationMs: 0,
              data: {
                toolCallId: pending.executionId,
                toolName: pending.normalizedToolName,
                arguments: pending.params,
                permitted: true,
              },
            },
            success
              ? {
                  type: 'tool_result',
                  timestamp: completedAt,
                  durationMs,
                  data: {
                    toolCallId: pending.executionId,
                    toolName: pending.normalizedToolName,
                    success: true,
                    result: event.result,
                  },
                }
              : {
                  type: 'error',
                  timestamp: completedAt,
                  durationMs,
                  data: {
                    code: 'tool_error',
                    message: errorText ?? 'tool execution failed',
                    recoverable: true,
                  },
                },
          ],
          output: success
            ? {
                message: `Tool ${pending.normalizedToolName} executed`,
                toolCalls: [
                  {
                    id: pending.executionId,
                    name: pending.normalizedToolName,
                    arguments: pending.params,
                    result: event.result,
                    durationMs,
                    permitted: true,
                    success: true,
                  },
                ],
              }
            : undefined,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalCost: 0,
          },
          error: success ? undefined : errorText,
          labels: {
            execution_id: pending.executionId,
            source: 'openclaw-plugin',
            tool: pending.normalizedToolName,
          },
          adapter_id: adapterId,
        },
      });
    },
    { priority: -100 }
  );

  log(
    `[clasper] Hook-based governance installed (before_tool_call). ` +
      `No OpenClaw tool with side effects can execute unless Clasper explicitly allows it.`
  );
}
