import type { PolicyDecision, PolicyObject } from './policySchema.js';
import { listPolicies } from './policyStore.js';
import { config } from '../core/config.js';
import {
  evaluateOperator,
  isSafeDottedPath,
  parseConditionExpression,
  resolveTemplates,
  type ConditionOperator,
} from './conditionOperators.js';

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
    targets?: string[] | { paths?: string[]; hosts?: string[] };
    exec?: {
      argv0?: string;
      argv?: string[];
      cwd?: string;
    };
    side_effects?: {
      writes_possible?: boolean;
      network_possible?: boolean;
    };
  };
  templateVars?: Record<string, string>;
  provenance?: {
    source?: string;
    publisher?: string;
  };
}

export interface ConditionDetail {
  field: string;
  operator: ConditionOperator | 'min_cost' | 'max_cost' | 'capability';
  expected: unknown;
  actual: unknown;
  result: boolean;
}

export interface PolicyDecisionTrace {
  policy_id: string;
  result: 'matched' | 'skipped';
  decision?: PolicyDecision;
  explanation?: string;
  condition_details?: ConditionDetail[];
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
  const conditions = (policy.conditions || {}) as Record<string, unknown>;
  if (
    conditions.adapter_risk_class &&
    (typeof conditions.adapter_risk_class !== 'string' ||
      conditions.adapter_risk_class !== ctx.adapter_risk_class)
  ) {
    return false;
  }
  if (conditions.tool && (typeof conditions.tool !== 'string' || conditions.tool !== ctx.tool))
    return false;
  if (
    conditions.tool_group &&
    (typeof conditions.tool_group !== 'string' || conditions.tool_group !== ctx.tool_group)
  ) {
    return false;
  }
  if (
    conditions.skill_state &&
    (typeof conditions.skill_state !== 'string' || conditions.skill_state !== ctx.skill_state)
  ) {
    return false;
  }
  if (
    conditions.risk_level &&
    (typeof conditions.risk_level !== 'string' || conditions.risk_level !== ctx.risk_level)
  ) {
    return false;
  }
  if (
    conditions.tenant_id &&
    (typeof conditions.tenant_id !== 'string' || conditions.tenant_id !== ctx.tenant_id)
  ) {
    return false;
  }
  if (
    conditions.workspace_id &&
    (typeof conditions.workspace_id !== 'string' || conditions.workspace_id !== ctx.workspace_id)
  ) {
    return false;
  }
  if (
    typeof conditions.min_cost === 'number' &&
    (ctx.estimated_cost ?? 0) < conditions.min_cost
  )
    return false;
  if (
    typeof conditions.max_cost === 'number' &&
    (ctx.estimated_cost ?? 0) > conditions.max_cost
  )
    return false;
  if (
    conditions.capability &&
    (typeof conditions.capability !== 'string' ||
      !ctx.requested_capabilities?.includes(conditions.capability))
  ) {
    return false;
  }
  if (conditions.intent && (typeof conditions.intent !== 'string' || conditions.intent !== ctx.intent))
    return false;
  if (conditions.context && typeof conditions.context === 'object' && !Array.isArray(conditions.context)) {
    const cc = conditions.context as Record<string, unknown>;
    const rc = ctx.context;
    if (
      cc.external_network !== undefined &&
      (typeof cc.external_network !== 'boolean' || rc?.external_network !== cc.external_network)
    ) {
      return false;
    }
    if (
      cc.writes_files !== undefined &&
      (typeof cc.writes_files !== 'boolean' || rc?.writes_files !== cc.writes_files)
    ) {
      return false;
    }
    if (
      cc.elevated_privileges !== undefined &&
      (typeof cc.elevated_privileges !== 'boolean' ||
        rc?.elevated_privileges !== cc.elevated_privileges)
    ) {
      return false;
    }
    if (
      cc.package_manager !== undefined &&
      (typeof cc.package_manager !== 'string' || rc?.package_manager !== cc.package_manager)
    ) {
      return false;
    }
  }
  if (
    conditions.provenance &&
    typeof conditions.provenance === 'object' &&
    !Array.isArray(conditions.provenance)
  ) {
    const cp = conditions.provenance as Record<string, unknown>;
    const rp = ctx.provenance;
    if (cp.source !== undefined && (typeof cp.source !== 'string' || rp?.source !== cp.source))
      return false;
    if (
      cp.publisher !== undefined &&
      (typeof cp.publisher !== 'string' || rp?.publisher !== cp.publisher)
    ) {
      return false;
    }
  }
  return true;
}

function getPathArray(contextTargets: PolicyContext['context']): string[] | undefined {
  const targets = contextTargets?.targets;
  if (!targets) return undefined;
  if (Array.isArray(targets)) return targets;
  return targets.paths;
}

function getNestedValue(input: unknown, dottedPath: string): unknown {
  if (!isSafeDottedPath(dottedPath)) return undefined;
  const keys = dottedPath.split('.');
  let current = input as Record<string, unknown> | undefined;
  for (const key of keys) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = current[key] as Record<string, unknown> | undefined;
  }
  return current as unknown;
}

function evaluateConditionField(
  field: string,
  rawCondition: unknown,
  actual: unknown,
  templateVars: Record<string, string>,
  details: ConditionDetail[]
): boolean {
  let parsedInput: unknown;
  try {
    parsedInput = resolveTemplates(rawCondition, templateVars);
  } catch {
    details.push({ field, operator: 'eq', expected: rawCondition, actual, result: false });
    return false;
  }
  const parsed = parseConditionExpression(parsedInput);
  if (!parsed) {
    details.push({ field, operator: 'eq', expected: rawCondition, actual, result: false });
    return false;
  }
  const result = evaluateOperator(parsed.operator, actual, parsed.expected);
  details.push({
    field,
    operator: parsed.operator,
    expected: parsed.expected,
    actual,
    result,
  });
  return result;
}

function conditionsMatchExtended(
  policy: PolicyObject,
  ctx: PolicyContext
): { matched: boolean; details: ConditionDetail[] } {
  const conditions = (policy.conditions || {}) as Record<string, unknown>;
  const details: ConditionDetail[] = [];
  const templateVars = ctx.templateVars || {};
  const contextPaths = getPathArray(ctx.context);

  const fieldMap: Array<{ field: string; condition: unknown; actual: unknown }> = [
    { field: 'adapter_risk_class', condition: conditions.adapter_risk_class, actual: ctx.adapter_risk_class },
    { field: 'tool', condition: conditions.tool, actual: ctx.tool },
    { field: 'tool_group', condition: conditions.tool_group, actual: ctx.tool_group },
    { field: 'skill_state', condition: conditions.skill_state, actual: ctx.skill_state },
    { field: 'risk_level', condition: conditions.risk_level, actual: ctx.risk_level },
    { field: 'tenant_id', condition: conditions.tenant_id, actual: ctx.tenant_id },
    { field: 'workspace_id', condition: conditions.workspace_id, actual: ctx.workspace_id },
    { field: 'intent', condition: conditions.intent, actual: ctx.intent },
    { field: 'provenance.source', condition: (conditions.provenance as Record<string, unknown> | undefined)?.source, actual: ctx.provenance?.source },
    { field: 'provenance.publisher', condition: (conditions.provenance as Record<string, unknown> | undefined)?.publisher, actual: ctx.provenance?.publisher },
    { field: 'context.external_network', condition: (conditions.context as Record<string, unknown> | undefined)?.external_network, actual: ctx.context?.external_network },
    { field: 'context.writes_files', condition: (conditions.context as Record<string, unknown> | undefined)?.writes_files, actual: ctx.context?.writes_files },
    { field: 'context.elevated_privileges', condition: (conditions.context as Record<string, unknown> | undefined)?.elevated_privileges, actual: ctx.context?.elevated_privileges },
    { field: 'context.package_manager', condition: (conditions.context as Record<string, unknown> | undefined)?.package_manager, actual: ctx.context?.package_manager },
    { field: 'context.exec.argv0', condition: getNestedValue(conditions, 'context.exec.argv0'), actual: ctx.context?.exec?.argv0 },
    { field: 'context.exec.cwd', condition: getNestedValue(conditions, 'context.exec.cwd'), actual: ctx.context?.exec?.cwd },
    { field: 'context.targets.paths', condition: getNestedValue(conditions, 'context.targets.paths'), actual: contextPaths },
    { field: 'context.targets.hosts', condition: getNestedValue(conditions, 'context.targets.hosts'), actual: Array.isArray(ctx.context?.targets) ? undefined : ctx.context?.targets?.hosts },
    { field: 'context.side_effects.writes_possible', condition: getNestedValue(conditions, 'context.side_effects.writes_possible'), actual: ctx.context?.side_effects?.writes_possible },
    { field: 'context.side_effects.network_possible', condition: getNestedValue(conditions, 'context.side_effects.network_possible'), actual: ctx.context?.side_effects?.network_possible },
  ];

  for (const item of fieldMap) {
    if (item.condition === undefined) continue;
    if (!evaluateConditionField(item.field, item.condition, item.actual, templateVars, details)) {
      return { matched: false, details };
    }
  }

  if (conditions.min_cost !== undefined) {
    const expected = conditions.min_cost;
    const actual = ctx.estimated_cost ?? 0;
    const result = typeof expected === 'number' && actual >= expected;
    details.push({ field: 'min_cost', operator: 'min_cost', expected, actual, result });
    if (!result) return { matched: false, details };
  }

  if (conditions.max_cost !== undefined) {
    const expected = conditions.max_cost;
    const actual = ctx.estimated_cost ?? 0;
    const result = typeof expected === 'number' && actual <= expected;
    details.push({ field: 'max_cost', operator: 'max_cost', expected, actual, result });
    if (!result) return { matched: false, details };
  }

  if (conditions.capability !== undefined) {
    const expected = conditions.capability;
    const actual = ctx.requested_capabilities || [];
    const result =
      typeof expected === 'string' &&
      Array.isArray(actual) &&
      actual.includes(expected);
    details.push({ field: 'capability', operator: 'capability', expected, actual, result });
    if (!result) return { matched: false, details };
  }

  for (const [key, value] of Object.entries(conditions)) {
    if (!key.includes('.')) continue;
    if (!isSafeDottedPath(key)) {
      details.push({ field: key, operator: 'eq', expected: value, actual: undefined, result: false });
      return { matched: false, details };
    }
    const actual = getNestedValue(ctx, key);
    if (!evaluateConditionField(key, value, actual, templateVars, details)) {
      return { matched: false, details };
    }
  }

  return { matched: true, details };
}

function deriveConditionExplanation(trace: ConditionDetail[]): string | undefined {
  const matched = trace.find((entry) => entry.result && entry.operator === 'in' && entry.field === 'context.exec.argv0');
  if (matched) {
    return `Allowed: argv0 matched allowlist (${String(matched.actual)})`;
  }
  const blocked = trace.find(
    (entry) => !entry.result && (entry.operator === 'all_under' || entry.operator === 'any_under')
  );
  if (blocked) {
    return 'Blocked: path outside allowed scope';
  }
  return undefined;
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
    const inScope = scopeMatches(policy, ctx);
    const subjectMatch = inScope ? subjectMatches(policy, ctx) : false;
    const conditionResult =
      inScope && subjectMatch
        ? config.policyOperatorsEnabled
          ? conditionsMatchExtended(policy, ctx)
          : { matched: conditionsMatch(policy, ctx), details: [] }
        : { matched: false, details: [] };
    const isMatch = inScope && subjectMatch && conditionResult.matched;
    if (isMatch) {
      const explanation = policy.explanation || deriveConditionExplanation(conditionResult.details);
      matched.push(policy);
      decisionTrace.push({
        policy_id: policy.policy_id,
        result: 'matched',
        decision: policy.effect.decision,
        explanation,
        condition_details: conditionResult.details,
      });
    } else {
      decisionTrace.push({
        policy_id: policy.policy_id,
        result: 'skipped',
        condition_details: conditionResult.details.length > 0 ? conditionResult.details : undefined,
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
  const winnerTrace = decisionTrace.find((entry) => entry.policy_id === winner.policy_id && entry.result === 'matched');
  return {
    decision: winner.effect.decision,
    matched_policies: matched.map((p) => p.policy_id),
    decision_trace: decisionTrace,
    explanation: winner.explanation || winnerTrace?.explanation || deriveConditionExplanation(winnerTrace?.condition_details || []),
  };
}
