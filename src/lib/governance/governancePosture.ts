/**
 * Governance posture analyzer.
 * Reusable module for API/CLI; compute mode, status, coverage—not in HTTP handlers.
 */
import { config } from '../core/config.js';
import { getEngineVersion } from '../core/version.js';
import { hasFallbackPolicy, computeGovernanceStatus, type GovernanceMode, type GovernanceStatus } from './governanceMode.js';
import { listPolicies } from '../policy/policyStore.js';
import type { PolicyObject } from '../policy/policySchema.js';
import { normalizeToolName } from '../tools/toolIdentity.js';
import { getAdapterRegistry } from '../adapters/registry.js';

export interface AdapterPostureContext {
  tenant_id: string;
  workspace_id?: string;
  environment?: string;
  adapter_id: string;
}

export interface GovernancePostureResult {
  adapter: string;
  mode: GovernanceMode;
  status: GovernanceStatus;
  engine_version: string;
  fallback_present: boolean;
  fallback_enabled: boolean;
  policy_count: number;
  covered_tools: string[];
  uncovered_tools: string[];
}

/**
 * Extract tool patterns from a policy that would provide coverage.
 * Returns normalized tool names or prefix patterns (e.g. "shell" for prefix "shell.").
 */
function getPolicyToolPatterns(policy: PolicyObject): Array<{ tool: string; isPrefix?: boolean }> {
  const out: Array<{ tool: string; isPrefix?: boolean }> = [];
  const conditions = policy.conditions as Record<string, unknown> | undefined;
  const subject = policy.subject;

  if (subject?.type === 'tool' && subject.name) {
    out.push({ tool: normalizeToolName(subject.name) });
  }

  if (!conditions) return out;
  const toolCond = conditions.tool;
  if (toolCond === undefined) return out;

  if (typeof toolCond === 'string') {
    out.push({ tool: normalizeToolName(toolCond) });
  } else if (typeof toolCond === 'object' && toolCond !== null) {
    const obj = toolCond as Record<string, unknown>;
    if (obj.prefix && typeof obj.prefix === 'string') {
      const normalized = normalizeToolName(obj.prefix);
      out.push({ tool: normalized.endsWith('.') ? normalized.slice(0, -1) : normalized, isPrefix: true });
    }
    if (Array.isArray(obj.in)) {
      for (const t of obj.in) {
        if (typeof t === 'string') out.push({ tool: normalizeToolName(t) });
      }
    }
  }
  return out;
}

function toolMatchesPattern(tool: string, pattern: { tool: string; isPrefix?: boolean }): boolean {
  const normTool = normalizeToolName(tool);
  if (pattern.isPrefix) {
    return normTool === pattern.tool || normTool.startsWith(pattern.tool + '.');
  }
  return normTool === pattern.tool;
}

/**
 * Compute whether a tool is covered by any policy.
 */
function isToolCovered(tool: string, policies: PolicyObject[]): boolean {
  for (const policy of policies) {
    const patterns = getPolicyToolPatterns(policy);
    if (patterns.length === 0) {
      const subject = policy.subject;
      if (subject?.type === 'tool' && !subject.name) return true;
      continue;
    }
    for (const p of patterns) {
      if (toolMatchesPattern(tool, p)) return true;
    }
  }
  return false;
}

/**
 * Compute governance posture for an adapter context.
 */
export function computePosture(ctx: AdapterPostureContext): GovernancePostureResult {
  const mode: GovernanceMode = config.mode;
  const policies = listPolicies({
    tenantId: ctx.tenant_id,
    workspaceId: ctx.workspace_id,
    environment: ctx.environment,
    enabled: true,
  });

  const fallbackPolicy = policies.find((p) => {
    const s = p.subject;
    return s?.type === 'tool' && !s.name && (p.precedence ?? 0) <= 0;
  });
  const fallback_present = !!fallbackPolicy;
  const fallback_enabled = fallbackPolicy?.enabled ?? false;

  const status = computeGovernanceStatus(mode, fallback_present);

  const registry = getAdapterRegistry();
  const adapterRecord = registry.get(ctx.tenant_id, ctx.adapter_id);
  const allTools = adapterRecord?.tool_capabilities ?? [];
  const normalizedToolSet = new Set<string>();
  for (const t of allTools) {
    const n = normalizeToolName(t);
    if (n) normalizedToolSet.add(n);
  }

  const covered = new Set<string>();
  const uncovered = new Set<string>();
  for (const norm of normalizedToolSet) {
    const coveredByPolicy = isToolCovered(norm, policies);
    if (coveredByPolicy) covered.add(norm);
    else uncovered.add(norm);
  }

  return {
    adapter: ctx.adapter_id,
    mode,
    status,
    engine_version: getEngineVersion(),
    fallback_present,
    fallback_enabled,
    policy_count: policies.length,
    covered_tools: [...covered].sort(),
    uncovered_tools: [...uncovered].sort(),
  };
}
