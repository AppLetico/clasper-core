import { getDatabase } from "../core/db.js";
import type { AgentTrace } from "../tracing/trace.js";

export type GovernanceDecision = "allow" | "deny" | "pending_approval" | "approved_local" | "unknown";

export type ToolDeny = {
  tool: string;
  reason?: string | null;
  policy_id?: string | null;
};

export type ScopeDelta = {
  cost_used: number | null;
  cost_max: number | null;
  steps_used: number | null;
  steps_max: number | null;
  within_scope: boolean | null;
};

export type GovernanceView = {
  execution_id: string | null;
  decision: GovernanceDecision;
  decision_id: string | null;
  required_role: string | null;
  expires_at: string | null;
  policy_ids: string[];
  policy_fallback_hit: boolean;
  denied_tools: ToolDeny[];
  scope_delta: ScopeDelta;
  decision_summary: string;
};

export type DecisionRow = {
  decision_id: string;
  tenant_id: string;
  execution_id: string;
  status: string;
  required_role: string | null;
  expires_at: string | null;
  request_snapshot: string | null;
  granted_scope: string | null;
  resolution: string | null;
  updated_at: string;
};

export type ToolAuthRow = {
  tenant_id: string;
  execution_id: string;
  tool: string;
  decision: string;
  policy_id: string | null;
  reason: string | null;
  created_at: string;
};

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function extractPolicyIdsFromDecisionSnapshot(snapshotJson: string | null): string[] {
  if (!snapshotJson) return [];
  try {
    const snap = JSON.parse(snapshotJson) as any;
    const matched = snap?.decision?.matched_policies;
    if (Array.isArray(matched)) {
      return matched.filter((p: any) => typeof p === "string");
    }
    return [];
  } catch {
    return [];
  }
}

function extractPolicyFallbackHitFromDecisionSnapshot(snapshotJson: string | null): boolean {
  if (!snapshotJson) return false;
  try {
    const snap = JSON.parse(snapshotJson) as any;
    return snap?.decision?.policy_fallback_hit === true;
  } catch {
    return false;
  }
}

export function loadGovernanceMaps(tenantId: string, executionIds: string[]) {
  const execIds = uniq(executionIds.filter((x): x is string => typeof x === "string" && x.length > 0));
  const decisionsByExecutionId = new Map<string, DecisionRow>();
  const toolAuthsByExecutionId = new Map<string, ToolAuthRow[]>();

  if (execIds.length === 0) {
    return { decisionsByExecutionId, toolAuthsByExecutionId };
  }

  const db = getDatabase();
  const placeholders = execIds.map(() => "?").join(", ");

  // Latest decision per execution_id
  const decisionRows = db
    .prepare(
      `
      SELECT decision_id, tenant_id, execution_id, status, required_role, expires_at, request_snapshot, granted_scope, resolution, updated_at
      FROM decisions
      WHERE tenant_id = ?
        AND execution_id IN (${placeholders})
      ORDER BY updated_at DESC
    `
    )
    .all(tenantId, ...execIds) as DecisionRow[];

  for (const row of decisionRows) {
    if (!decisionsByExecutionId.has(row.execution_id)) {
      decisionsByExecutionId.set(row.execution_id, row);
    }
  }

  const toolRows = db
    .prepare(
      `
      SELECT tenant_id, execution_id, tool, decision, policy_id, reason, created_at
      FROM tool_authorizations
      WHERE tenant_id = ?
        AND execution_id IN (${placeholders})
      ORDER BY created_at ASC
    `
    )
    .all(tenantId, ...execIds) as ToolAuthRow[];

  for (const row of toolRows) {
    const arr = toolAuthsByExecutionId.get(row.execution_id) || [];
    arr.push(row);
    toolAuthsByExecutionId.set(row.execution_id, arr);
  }

  return { decisionsByExecutionId, toolAuthsByExecutionId };
}

function computeScopeDelta(trace: AgentTrace): ScopeDelta {
  const cost_used = trace.used_scope?.actual_cost ?? null;
  const cost_max = trace.granted_scope?.max_cost ?? null;
  const steps_used = trace.used_scope?.step_count ?? null;
  const steps_max = trace.granted_scope?.max_steps ?? null;

  const within_cost = cost_used !== null && cost_max !== null ? cost_used <= cost_max : null;
  const within_steps = steps_used !== null && steps_max !== null ? steps_used <= steps_max : null;

  let within_scope: boolean | null = null;
  if (within_cost !== null || within_steps !== null) {
    within_scope = (within_cost ?? true) && (within_steps ?? true);
  }

  return { cost_used, cost_max, steps_used, steps_max, within_scope };
}

function buildDecisionSummary(params: {
  decision: GovernanceDecision;
  policyIds: string[];
  deniedTools: ToolDeny[];
  scopeDelta: ScopeDelta;
  requestedCapabilities: string[];
}) {
  const policyPart = params.policyIds.length ? `policy: ${params.policyIds.slice(0, 2).join(", ")}${params.policyIds.length > 2 ? "…" : ""}` : null;

  if (params.decision === "pending_approval") {
    const caps = params.requestedCapabilities.length ? params.requestedCapabilities.slice(0, 3).join(", ") : "capabilities";
    return `Pending approval → requested ${caps}${policyPart ? ` (${policyPart})` : ""}`;
  }

  if (params.decision === "approved_local") {
    const { cost_used, cost_max, steps_used, steps_max } = params.scopeDelta;
    const costPart = cost_used !== null && cost_max !== null ? `cost ${cost_used.toFixed(4)}/${cost_max}` : null;
    const stepPart = steps_used !== null && steps_max !== null ? `steps ${steps_used}/${steps_max}` : null;
    const scopePart = [costPart, stepPart].filter(Boolean).join(", ");
    return `Local approval (untrusted)${scopePart ? ` → ${scopePart}` : ""}${policyPart ? ` (${policyPart})` : ""}`;
  }

  if (params.deniedTools.length) {
    const first = params.deniedTools[0]!;
    const denyPolicy = first.policy_id ? `policy: ${first.policy_id}` : policyPart;
    return `Denied → ${first.tool} blocked${denyPolicy ? ` (${denyPolicy})` : ""}`;
  }

  const { cost_used, cost_max, steps_used, steps_max } = params.scopeDelta;
  const costPart = cost_used !== null && cost_max !== null ? `cost ${cost_used.toFixed(4)}/${cost_max}` : null;
  const stepPart = steps_used !== null && steps_max !== null ? `steps ${steps_used}/${steps_max}` : null;
  const scopePart = [costPart, stepPart].filter(Boolean).join(", ");
  return `Allowed${scopePart ? ` → ${scopePart}` : ""}${policyPart ? ` (${policyPart})` : ""}`;
}

export function buildGovernanceView(params: {
  trace: AgentTrace;
  executionId: string | null;
  decisionRow?: DecisionRow;
  toolAuthRows?: ToolAuthRow[];
}): GovernanceView {
  const requestedCapabilities = params.trace.granted_scope?.capabilities || [];

  const policyIds = uniq([
    ...(params.toolAuthRows || []).map((r) => r.policy_id).filter((x): x is string => !!x),
    ...extractPolicyIdsFromDecisionSnapshot(params.decisionRow?.request_snapshot || null)
  ]);

  const denied_tools: ToolDeny[] = (params.toolAuthRows || [])
    .filter((r) => r.decision !== "allow")
    .map((r) => ({ tool: r.tool, reason: r.reason, policy_id: r.policy_id }));

  let decision: GovernanceDecision = "unknown";
  if (!params.executionId) {
    decision = "unknown";
  } else if (params.decisionRow?.status === "pending") {
    decision = "pending_approval";
  } else if (params.decisionRow?.status === "denied" || params.decisionRow?.status === "rejected") {
    decision = "deny";
  } else if (params.decisionRow?.status === "approved") {
    // Self-attested local approvals in Core
    let approvalType: string | null = null;
    if (params.decisionRow.resolution) {
      try {
        const r = JSON.parse(params.decisionRow.resolution) as any;
        approvalType = typeof r?.approval_type === "string" ? r.approval_type : null;
      } catch {
        approvalType = null;
      }
    }
    decision = approvalType === "local" ? "approved_local" : "allow";
  } else if (denied_tools.length > 0) {
    // If any tool was denied, reflect that in the narrative even if the execution decision was "allow".
    decision = "deny";
  } else if (params.decisionRow) {
    decision = "allow";
  } else {
    // No stored decision; infer "allow" since a trace exists, but keep it explicit.
    decision = "allow";
  }

  const scope_delta = computeScopeDelta(params.trace);
  const decision_summary = buildDecisionSummary({
    decision,
    policyIds,
    deniedTools: denied_tools,
    scopeDelta: scope_delta,
    requestedCapabilities
  });

  return {
    execution_id: params.executionId,
    decision,
    decision_id: params.decisionRow?.decision_id || null,
    required_role: params.decisionRow?.required_role || null,
    expires_at: params.decisionRow?.expires_at || null,
    policy_ids: policyIds,
    policy_fallback_hit: extractPolicyFallbackHitFromDecisionSnapshot(params.decisionRow?.request_snapshot || null),
    denied_tools,
    scope_delta,
    decision_summary
  };
}

