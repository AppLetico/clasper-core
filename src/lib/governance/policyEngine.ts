import { evaluatePolicies, type PolicyContext as PolicyEvalContext } from '../policy/policyEngine.js';
import type { PolicyDecision } from '../policy/policySchema.js';

export type PolicyContext = PolicyEvalContext;

export interface PolicyEvaluation {
  decision: PolicyDecision;
  matched_policies: string[];
  decision_trace: {
    policy_id: string;
    result: 'matched' | 'skipped';
    decision?: PolicyDecision;
    explanation?: string;
  }[];
  explanation?: string;
}

export function evaluatePolicy(ctx: PolicyContext): PolicyEvaluation {
  return evaluatePolicies(ctx);
}
