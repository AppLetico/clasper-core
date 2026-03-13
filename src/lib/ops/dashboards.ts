import { getDatabase } from "../core/db.js";
import { getTraceStore } from "../tracing/traceStore.js";
import { getRetentionPolicies } from "../tracing/retentionPolicies.js";
import { computeTraceRisk } from "./traceViews.js";
import { loadGovernanceMaps } from "./governanceViews.js";
import { buildGovernanceView } from "./governanceViews.js";
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "./pagination.js";

/**
 * Coverage metadata for dashboard data fidelity
 */
export interface DashboardCoverage {
  retention_mode: "full" | "sampled" | "errors_only";
  sampling_strategy: string | null;
  time_window: {
    start: string;
    end: string;
  };
  disclaimer: string;
}

/**
 * Get coverage metadata for a tenant's dashboard
 */
function getCoverageMetadata(tenantId: string): DashboardCoverage {
  const retention = getRetentionPolicies();
  const policy = retention.getPolicy(tenantId);

  const now = new Date();
  const retentionDays = policy?.retentionDays || 90;
  const startDate = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  const samplingStrategy = policy?.samplingStrategy || "full";
  const retentionMode = samplingStrategy as "full" | "sampled" | "errors_only";

  let disclaimer = `Metrics based on ${retentionMode} traces`;
  if (samplingStrategy !== "full") {
    disclaimer += ` (${samplingStrategy})`;
  }
  disclaimer += `, last ${retentionDays} days`;

  return {
    retention_mode: retentionMode,
    sampling_strategy: samplingStrategy === "full" ? null : samplingStrategy,
    time_window: {
      start: startDate.toISOString(),
      end: now.toISOString()
    },
    disclaimer
  };
}

export interface CostDashboardOptions {
  dailyLimit?: number;
  workspaceLimit?: number;
  skillLimit?: number;
  workspaceId?: string;
}

export function getCostDashboard(tenantId: string, options: CostDashboardOptions = {}) {
  const db = getDatabase();

  // Apply pagination limits with caps
  const dailyLimit = Math.min(options.dailyLimit || 30, MAX_PAGE_SIZE);
  const workspaceLimit = Math.min(options.workspaceLimit || 20, MAX_PAGE_SIZE);
  const skillLimit = Math.min(options.skillLimit || 20, MAX_PAGE_SIZE);

  const daily = db.prepare(`
    SELECT strftime('%Y-%m-%d', started_at) as day,
           SUM(total_cost) as total_cost,
           COUNT(*) as trace_count
    FROM traces
    WHERE tenant_id = ?${options.workspaceId ? " AND workspace_id = ?" : ""}
    GROUP BY day
    ORDER BY day DESC
    LIMIT ?
  `).all(
    options.workspaceId ? [tenantId, options.workspaceId, dailyLimit] : [tenantId, dailyLimit]
  ) as { day: string; total_cost: number; trace_count: number }[];

  const byWorkspace = db.prepare(`
    SELECT workspace_id,
           SUM(total_cost) as total_cost,
           COUNT(*) as trace_count
    FROM traces
    WHERE tenant_id = ?${options.workspaceId ? " AND workspace_id = ?" : ""}
    GROUP BY workspace_id
    ORDER BY total_cost DESC
    LIMIT ?
  `).all(
    options.workspaceId ? [tenantId, options.workspaceId, workspaceLimit] : [tenantId, workspaceLimit]
  ) as { workspace_id: string; total_cost: number; trace_count: number }[];

  const bySkill = db.prepare(`
    SELECT json_each.key as skill_name,
           SUM(total_cost) as total_cost,
           COUNT(*) as trace_count
    FROM traces, json_each(traces.skill_versions)
    WHERE tenant_id = ?${options.workspaceId ? " AND workspace_id = ?" : ""}
    GROUP BY json_each.key
    ORDER BY total_cost DESC
    LIMIT ?
  `).all(
    options.workspaceId ? [tenantId, options.workspaceId, skillLimit] : [tenantId, skillLimit]
  ) as { skill_name: string; total_cost: number; trace_count: number }[];

  return {
    daily,
    byWorkspace,
    bySkill,
    coverage: getCoverageMetadata(tenantId)
  };
}

export interface RiskDashboardOptions {
  limit?: number;
  highRiskLimit?: number;
}

export function getRiskDashboard(tenantId: string, options: RiskDashboardOptions = {}) {
  const traceStore = getTraceStore();

  // Apply pagination limits with caps
  const limit = Math.min(options.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const highRiskLimit = Math.min(options.highRiskLimit || 20, MAX_PAGE_SIZE);

  const result = traceStore.list({ tenantId, limit, offset: 0 });

  const levels: Record<string, number> = {};
  const recentHighRisk: string[] = [];

  for (const trace of result.traces) {
    const risk = computeTraceRisk(trace);
    levels[risk.level] = (levels[risk.level] || 0) + 1;
    if (risk.level === "high" || risk.level === "critical") {
      recentHighRisk.push(trace.id);
    }
  }

  return {
    levels,
    recent_high_risk: recentHighRisk.slice(0, highRiskLimit),
    coverage: getCoverageMetadata(tenantId)
  };
}

export interface GovernanceDashboardOptions {
  limit?: number;
  workspaceId?: string;
}

export function getGovernanceDashboard(tenantId: string, options: GovernanceDashboardOptions = {}) {
  const db = getDatabase();
  const limit = Math.min(options.limit || 500, MAX_PAGE_SIZE);

  const decisions = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM decisions
    WHERE tenant_id = ?
    GROUP BY status
  `).all(tenantId) as { status: string; count: number }[];

  const decisionCounts: Record<string, number> = {};
  for (const row of decisions) {
    decisionCounts[row.status] = row.count;
  }

  const traceStore = getTraceStore();
  const result = traceStore.list({
    tenantId,
    workspaceId: options.workspaceId,
    limit,
    offset: 0
  });

  const executionIds = result.traces
    .map((t) => (t.labels as Record<string, unknown>)?.execution_id)
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  const { decisionsByExecutionId, toolAuthsByExecutionId } = loadGovernanceMaps(tenantId, executionIds);

  let allowCount = 0;
  let denyCount = 0;
  let pendingCount = 0;
  const riskLevels: Record<string, number> = {};
  let adapterErrorCount = 0;
  let incidentCount = 0;

  for (const trace of result.traces) {
    const executionId = (trace.labels as Record<string, unknown>)?.execution_id as string | undefined;
    const governance = buildGovernanceView({
      trace,
      executionId: executionId || null,
      decisionRow: executionId ? decisionsByExecutionId.get(executionId) : undefined,
      toolAuthRows: executionId ? toolAuthsByExecutionId.get(executionId) : undefined
    });

    const decision = governance.decision || "unknown";
    if (decision === "allow" || decision === "approved_local") allowCount++;
    else if (decision === "deny") denyCount++;
    else if (decision === "pending_approval") pendingCount++;

    const risk = governance.risk_level || computeTraceRisk(trace).level;
    riskLevels[risk] = (riskLevels[risk] || 0) + 1;

    if (trace.error) adapterErrorCount++;
    if (trace.error || decision === "deny") incidentCount++;
  }

  const total = result.traces.length;
  const approvalRate = total > 0 ? Math.round((allowCount / total) * 100) : 0;
  const denialRate = total > 0 ? Math.round((denyCount / total) * 100) : 0;

  return {
    approval_rate: approvalRate,
    denial_rate: denialRate,
    pending_count: decisionCounts.pending || 0,
    allow_count: allowCount,
    deny_count: denyCount,
    risk_distribution: riskLevels,
    adapter_error_count: adapterErrorCount,
    incident_count: incidentCount,
    trace_sample_size: total,
    coverage: getCoverageMetadata(tenantId)
  };
}

export interface AgentsListOptions {
  limit?: number;
  workspaceId?: string;
}

export interface AgentSummary {
  agent_id: string;
  agent_role: string | null;
  trace_count: number;
}

export function getAgentsList(tenantId: string, options: AgentsListOptions = {}): AgentSummary[] {
  const traceStore = getTraceStore();
  const limit = Math.min(options.limit || 500, MAX_PAGE_SIZE);
  const result = traceStore.list({
    tenantId,
    workspaceId: options.workspaceId,
    limit,
    offset: 0
  });

  const byKey = new Map<string, { agent_id: string; agent_role: string | null; count: number }>();
  for (const trace of result.traces) {
    const labels = (trace.labels || {}) as Record<string, unknown>;
    const agentId = typeof labels.agent_id === "string" ? labels.agent_id : (trace.agentRole ? `role:${trace.agentRole}` : null);
    const agentRole = typeof labels.agent_role === "string" ? labels.agent_role : trace.agentRole || null;
    const key = agentId || `unknown:${trace.id}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count++;
    } else {
      byKey.set(key, {
        agent_id: agentId || "unknown",
        agent_role: agentRole,
        count: 1
      });
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.count - a.count)
    .map(({ agent_id, agent_role, count }) => ({ agent_id, agent_role, trace_count: count }));
}
