import type { PolicyDecision, PolicyObject } from './policySchema.js';
import { listPolicies } from './policyStore.js';

export interface PolicyContext {
  tenant_id: string;
  workspace_id?: string;
  environment?: string;
  tool?: string;
  /** Tool group / category (e.g. "runtime", "fs", "web"). */
  tool_group?: string;
  adapter_id?: string;
  adapter_risk_class?: string;
  skill_state?: string;
  risk_level?: string;
  estimated_cost?: number;
  requested_capabilities?: string[];
  intent?: string;
  context?: {
    external_network?: boolean;
    writes_files?: boolean;
    elevated_privileges?: boolean;
    package_manager?: string;
  };
  provenance?: {
    source?: string;
    publisher?: string;
  };
}

export interface PolicyDecisionTrace {
  policy_id: string;
  result: 'matched' | 'skipped';
  decision?: PolicyDecision;
  explanation?: string;
}

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  matched_policies: string[];
  decision_trace: PolicyDecisionTrace[];
  explanation?: string;
}

function scopeMatches(policy: PolicyObject, ctx: PolicyContext): boolean {
  const scope = policy.scope || {};
  if (scope.tenant_id && scope.tenant_id !== ctx.tenant_id) return false;
  if (scope.workspace_id && scope.workspace_id !== ctx.workspace_id) return false;
  if (scope.environment && scope.environment !== ctx.environment) return false;
  return true;
}

function subjectMatches(policy: PolicyObject, ctx: PolicyContext): boolean {
  const subject = policy.subject;
  if (subject.type === 'tool') {
    return !subject.name || subject.name === ctx.tool;
  }
  if (subject.type === 'adapter') {
    return !subject.name || subject.name === ctx.adapter_id;
  }
  if (subject.type === 'skill') {
    return !subject.name || subject.name === ctx.skill_state;
  }
  if (subject.type === 'environment') {
    return !subject.name || subject.name === ctx.environment;
  }
  if (subject.type === 'risk') {
    return !subject.name || subject.name === ctx.risk_level;
  }
  if (subject.type === 'cost') {
    return true;
  }
  return true;
}

function conditionsMatch(policy: PolicyObject, ctx: PolicyContext): boolean {
  const conditions = policy.conditions || {};
  if (conditions.adapter_risk_class && conditions.adapter_risk_class !== ctx.adapter_risk_class)
    return false;
  if (conditions.tool && conditions.tool !== ctx.tool) return false;
  if (conditions.tool_group && conditions.tool_group !== ctx.tool_group) return false;
  if (conditions.skill_state && conditions.skill_state !== ctx.skill_state) return false;
  if (conditions.risk_level && conditions.risk_level !== ctx.risk_level) return false;
  if (conditions.tenant_id && conditions.tenant_id !== ctx.tenant_id) return false;
  if (conditions.workspace_id && conditions.workspace_id !== ctx.workspace_id) return false;
  if (conditions.min_cost !== undefined && (ctx.estimated_cost ?? 0) < conditions.min_cost)
    return false;
  if (conditions.max_cost !== undefined && (ctx.estimated_cost ?? 0) > conditions.max_cost)
    return false;
  if (conditions.capability && !ctx.requested_capabilities?.includes(conditions.capability))
    return false;
  if (conditions.intent && conditions.intent !== ctx.intent) return false;
  if (conditions.context) {
    const cc = conditions.context;
    const rc = ctx.context;
    if (cc.external_network !== undefined && rc?.external_network !== cc.external_network)
      return false;
    if (cc.writes_files !== undefined && rc?.writes_files !== cc.writes_files) return false;
    if (cc.elevated_privileges !== undefined && rc?.elevated_privileges !== cc.elevated_privileges)
      return false;
    if (cc.package_manager !== undefined && rc?.package_manager !== cc.package_manager)
      return false;
  }
  if (conditions.provenance) {
    const cp = conditions.provenance;
    const rp = ctx.provenance;
    if (cp.source !== undefined && rp?.source !== cp.source) return false;
    if (cp.publisher !== undefined && rp?.publisher !== cp.publisher) return false;
  }
  return true;
}

function specificityScore(policy: PolicyObject): number {
  const scope = policy.scope || {};
  if (scope.workspace_id && scope.environment) return 3;
  if (scope.environment) return 2;
  return 1;
}

function decisionRank(decision: PolicyDecision): number {
  if (decision === 'deny') return 3;
  if (decision === 'require_approval') return 2;
  return 1;
}

export function evaluatePolicies(ctx: PolicyContext): PolicyEvaluationResult {
  const policies = listPolicies({
    tenantId: ctx.tenant_id,
    workspaceId: ctx.workspace_id,
    environment: ctx.environment,
    enabled: true,
  });

  const decisionTrace: PolicyDecisionTrace[] = [];
  const matched: PolicyObject[] = [];

  for (const policy of policies) {
    const isMatch =
      scopeMatches(policy, ctx) &&
      subjectMatches(policy, ctx) &&
      conditionsMatch(policy, ctx);
    if (isMatch) {
      matched.push(policy);
      decisionTrace.push({
        policy_id: policy.policy_id,
        result: 'matched',
        decision: policy.effect.decision,
        explanation: policy.explanation,
      });
    } else {
      decisionTrace.push({
        policy_id: policy.policy_id,
        result: 'skipped',
      });
    }
  }

  if (matched.length === 0) {
    return {
      decision: 'allow',
      matched_policies: [],
      decision_trace: decisionTrace,
      explanation: 'No matching policy',
    };
  }

  const sorted = [...matched].sort((a, b) => {
    const precA = a.precedence ?? 0;
    const precB = b.precedence ?? 0;
    if (precA !== precB) return precB - precA;
    const specA = specificityScore(a);
    const specB = specificityScore(b);
    if (specA !== specB) return specB - specA;
    return decisionRank(b.effect.decision) - decisionRank(a.effect.decision);
  });

  const winner = sorted[0];
  return {
    decision: winner.effect.decision,
    matched_policies: matched.map((p) => p.policy_id),
    decision_trace: decisionTrace,
    explanation: winner.explanation,
  };
}
