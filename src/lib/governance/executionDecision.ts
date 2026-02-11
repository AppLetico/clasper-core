import { v7 as uuidv7 } from 'uuid';
import type { AdapterRiskClass } from '../adapters/types.js';
import type { RiskLevel } from './riskScoring.js';
import { calculateRiskScore } from './riskScoring.js';
import { getBudgetManager } from './budgetManager.js';
import type { BudgetCheckResult } from './budgetManager.js';
import type { SkillState } from '../skills/skillRegistry.js';
import { config, getApprovalMode } from '../core/config.js';
import { logOverrideUsed, logApprovalAutoAllowedInCore, logPolicyFallbackHit } from './auditLog.js';
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
  /** Specific tool being invoked (e.g. "exec", "write_file"). */
  tool?: string;
  /** Tool group / category (e.g. "runtime", "fs", "web"). */
  tool_group?: string;
  /** Skill requesting the tool invocation (e.g. "shell_agent"). */
  skill?: string;
  /** How the intent was derived (e.g. "heuristic"). Assistive signal only. */
  intent_source?: string;
  skill_state?: SkillState;
  temperature?: number;
  data_sensitivity?: 'none' | 'low' | 'medium' | 'high' | 'pii';
  skill_tested?: boolean;
  skill_pinned?: boolean;
  custom_flags?: string[];
  rbac_allowed?: boolean;
  callback_url?: string;
  intent?: string;
  context?: {
    external_network?: boolean;
    writes_files?: boolean;
    elevated_privileges?: boolean;
    package_manager?: string;
    targets?: string[];
  };
  provenance?: {
    source?: 'marketplace' | 'internal' | 'git' | 'unknown';
    publisher?: string;
    artifact_hash?: string;
  };
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
  const approvalMode = getApprovalMode();
  let fallbackHit = false;

  if (request.rbac_allowed === false) {
    return {
      allowed: false,
      execution_id: executionId,
      blocked_reason: 'rbac_denied',
      decision: 'deny',
      policy_fallback_hit: fallbackHit,
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
    context: request.context,
    provenance: request.provenance,
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
    tool: request.tool,
    tool_group: request.tool_group,
    skill_state: request.skill_state,
    risk_level: riskScore.level,
    estimated_cost: request.estimated_cost,
    requested_capabilities: request.requested_capabilities,
    intent: request.intent,
    context: request.context,
    provenance: request.provenance,
  });

  const matchedPolicyId =
    policyResult.matched_policies.length === 1 ? policyResult.matched_policies[0] : undefined;
  const matchedTrace =
    policyResult.decision_trace.filter((entry) => entry.result === 'matched');
  fallbackHit = Boolean(
    matchedPolicyId &&
      matchedTrace.length === 1 &&
      matchedTrace[0]?.policy_id === matchedPolicyId &&
      /fallback/i.test(matchedTrace[0]?.explanation ?? '')
  );

  if (fallbackHit && matchedPolicyId) {
    logPolicyFallbackHit({
      tenantId: request.tenant_id,
      workspaceId: request.workspace_id,
      executionId,
      adapterId: request.adapter_id,
      tool: request.tool,
      toolGroup: request.tool_group,
      policyId: matchedPolicyId,
      decision: policyResult.decision,
    });
  }

  if (!budgetCheck.allowed && !request.override) {
    return {
      allowed: false,
      execution_id: executionId,
      blocked_reason: budgetCheck.reason || 'budget_exceeded',
      decision: 'deny',
      matched_policies: policyResult.matched_policies,
      decision_trace: policyResult.decision_trace,
      explanation: policyResult.explanation,
      approval_mode: approvalMode,
      policy_fallback_hit: fallbackHit,
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
      approval_mode: approvalMode,
      policy_fallback_hit: fallbackHit,
    };
  }

  if (policyResult.decision === 'require_approval' && !request.override) {
    if (config.requireApprovalInCore === 'allow') {
      logApprovalAutoAllowedInCore({
        tenantId: request.tenant_id,
        workspaceId: request.workspace_id,
        executionId,
        reason: 'policy_requires_approval',
      });
      return {
        allowed: true,
        execution_id: executionId,
        granted_scope: buildGrantedScope(request, budgetCheck),
        decision: 'allow',
        matched_policies: policyResult.matched_policies,
        decision_trace: policyResult.decision_trace,
        explanation:
          (policyResult.explanation || '') +
          ' (AUTO-APPROVED: approval_mode=simulate; source=config_override)',
        auto_allowed_in_core: true,
        approval_mode: approvalMode,
        approval_source: 'config_override',
        policy_fallback_hit: fallbackHit,
      };
    }
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
      approval_mode: approvalMode,
      policy_fallback_hit: fallbackHit,
    };
  }

  if (APPROVAL_RISK_LEVELS.includes(riskScore.level) && !request.override) {
    if (config.requireApprovalInCore === 'allow') {
      logApprovalAutoAllowedInCore({
        tenantId: request.tenant_id,
        workspaceId: request.workspace_id,
        executionId,
        reason: 'risk_requires_approval',
      });
      return {
        allowed: true,
        execution_id: executionId,
        granted_scope: buildGrantedScope(request, budgetCheck),
        decision: 'allow',
        matched_policies: policyResult.matched_policies,
        decision_trace: policyResult.decision_trace,
        explanation:
          (policyResult.explanation || '') +
          ' (AUTO-APPROVED: approval_mode=simulate; source=config_override)',
        auto_allowed_in_core: true,
        approval_mode: approvalMode,
        approval_source: 'config_override',
        policy_fallback_hit: fallbackHit,
      };
    }
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
      approval_mode: approvalMode,
      policy_fallback_hit: fallbackHit,
    };
  }

  if (request.override) {
    logOverrideUsed({
      tenantId: request.tenant_id,
      workspaceId: request.workspace_id,
      userId: request.override.actor,
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
    approval_mode: approvalMode,
    policy_fallback_hit: fallbackHit,
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
