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
    condition_details?: {
      field: string;
      operator: string;
      expected: unknown;
      actual: unknown;
      result: boolean;
    }[];
  }[];
  explanation?: string;
}

export function evaluatePolicy(ctx: PolicyContext): PolicyEvaluation {
  return evaluatePolicies(ctx);
}
