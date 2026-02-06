import { v7 as uuidv7 } from 'uuid';
import type { AdapterRiskClass } from '../adapters/types.js';
import type { RiskLevel } from './riskScoring.js';
import { calculateRiskScore } from './riskScoring.js';
import { getBudgetManager } from './budgetManager.js';
import type { BudgetCheckResult } from './budgetManager.js';
import type { SkillState } from '../skills/skillRegistry.js';
import { logOverrideUsed } from './auditLog.js';
import type { OverrideRequest } from '../ops/overrides.js';
import type { ExecutionDecision } from '../adapters/executionContract.js';
import { evaluatePolicies } from '../policy/policyEngine.js';

export interface ExecutionDecisionRequest {
  execution_id?: string;
  tenant_id: string;
  workspace_id: string;
  environment?: string;
  adapter_id: string;
  adapter_risk_class?: AdapterRiskClass;
  requested_capabilities: string[];
  max_steps?: number;
  max_cost?: number;
  estimated_cost?: number;
  tool_count: number;
  tool_names?: string[];
  skill_state?: SkillState;
  temperature?: number;
  data_sensitivity?: 'none' | 'low' | 'medium' | 'high' | 'pii';
  skill_tested?: boolean;
  skill_pinned?: boolean;
  custom_flags?: string[];
  rbac_allowed?: boolean;
  callback_url?: string;
  override?: {
    request: OverrideRequest;
    actor: string;
    role: string;
    action?: string;
  };
}

const DEFAULT_MAX_STEPS = 100;
const DEFAULT_SCOPE_MINUTES = 15;
const APPROVAL_RISK_LEVELS: RiskLevel[] = ['high', 'critical'];

export function evaluateExecutionDecision(
  request: ExecutionDecisionRequest
): ExecutionDecision {
  const executionId = request.execution_id || uuidv7();

  if (request.rbac_allowed === false) {
    return {
      allowed: false,
      execution_id: executionId,
      blocked_reason: 'rbac_denied',
      decision: 'deny',
    };
  }

  const riskScore = calculateRiskScore({
    toolCount: request.tool_count,
    toolNames: request.tool_names,
    skillState: request.skill_state,
    temperature: request.temperature,
    dataSensitivity: request.data_sensitivity,
    skillTested: request.skill_tested,
    skillPinned: request.skill_pinned,
    customFlags: request.custom_flags,
    adapterRiskClass: request.adapter_risk_class,
    requestedCapabilities: request.requested_capabilities,
  });

  const budgetManager = getBudgetManager();
  const budgetCheck = budgetManager.checkBudget(
    request.tenant_id,
    request.estimated_cost ?? 0
  );

  const policyResult = evaluatePolicies({
    tenant_id: request.tenant_id,
    workspace_id: request.workspace_id,
    environment: request.environment,
    adapter_id: request.adapter_id,
    adapter_risk_class: request.adapter_risk_class,
    skill_state: request.skill_state,
    risk_level: riskScore.level,
    estimated_cost: request.estimated_cost,
  });

  if (!budgetCheck.allowed && !request.override) {
    return {
      allowed: false,
      execution_id: executionId,
      blocked_reason: budgetCheck.reason || 'budget_exceeded',
      decision: 'deny',
      matched_policies: policyResult.matched_policies,
      decision_trace: policyResult.decision_trace,
      explanation: policyResult.explanation,
    };
  }

  if (policyResult.decision === 'deny' && !request.override) {
    return {
      allowed: false,
      execution_id: executionId,
      blocked_reason: 'policy_denied',
      decision: 'deny',
      matched_policies: policyResult.matched_policies,
      decision_trace: policyResult.decision_trace,
      explanation: policyResult.explanation,
    };
  }

  if (policyResult.decision === 'require_approval' && !request.override) {
    return {
      allowed: false,
      execution_id: executionId,
      requires_approval: true,
      blocked_reason: 'policy_requires_approval',
      decision: 'require_approval',
      matched_policies: policyResult.matched_policies,
      decision_trace: policyResult.decision_trace,
      explanation: policyResult.explanation,
      granted_scope: buildGrantedScope(request, budgetCheck),
    };
  }

  if (APPROVAL_RISK_LEVELS.includes(riskScore.level) && !request.override) {
    return {
      allowed: false,
      execution_id: executionId,
      requires_approval: true,
      blocked_reason: `risk_requires_approval:${riskScore.level}`,
      decision: 'require_approval',
      matched_policies: policyResult.matched_policies,
      decision_trace: policyResult.decision_trace,
      explanation: policyResult.explanation,
      granted_scope: buildGrantedScope(request, budgetCheck),
    };
  }

  if (request.override) {
    logOverrideUsed(request.tenant_id, {
      workspaceId: request.workspace_id,
      actor: request.override.actor,
      role: request.override.role,
      action: request.override.action || 'execution_override',
      targetId: executionId,
      reasonCode: request.override.request.reason_code,
      justification: request.override.request.justification,
    });
  }

  return {
    allowed: true,
    execution_id: executionId,
    granted_scope: buildGrantedScope(request, budgetCheck),
    decision: 'allow',
    matched_policies: policyResult.matched_policies,
    decision_trace: policyResult.decision_trace,
    explanation: policyResult.explanation,
  };
}

function buildGrantedScope(
  request: ExecutionDecisionRequest,
  budgetCheck: BudgetCheckResult
) {
  const maxSteps = request.max_steps ?? DEFAULT_MAX_STEPS;
  const maxCost =
    request.max_cost ??
    (request.estimated_cost ?? (budgetCheck.remaining === Infinity ? 0 : budgetCheck.remaining));

  const remainingBudget =
    budgetCheck.remaining === Infinity ? maxCost : Math.min(maxCost, budgetCheck.remaining);

  return {
    capabilities: request.requested_capabilities,
    max_steps: maxSteps,
    max_cost: Math.max(0, remainingBudget),
    expires_at: new Date(Date.now() + DEFAULT_SCOPE_MINUTES * 60 * 1000).toISOString(),
  };
}
