import { z } from 'zod';

export const PolicyDecisionSchema = z.enum(['allow', 'deny', 'require_approval']);
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const PolicyScopeSchema = z.object({
  tenant_id: z.string().optional(),
  workspace_id: z.string().optional(),
  environment: z.string().optional(),
});

export const PolicySubjectSchema = z.object({
  type: z.enum(['adapter', 'tool', 'skill', 'environment', 'risk', 'cost']),
  name: z.string().optional(),
});

export const PolicyConditionsSchema = z.object({
  adapter_risk_class: z.string().optional(),
  tool: z.string().optional(),
  skill_state: z.string().optional(),
  risk_level: z.string().optional(),
  min_cost: z.number().optional(),
  max_cost: z.number().optional(),
  tenant_id: z.string().optional(),
  workspace_id: z.string().optional(),
});

export const PolicyEffectSchema = z.object({
  decision: PolicyDecisionSchema,
});

export const PolicySchema = z.object({
  policy_id: z.string(),
  scope: PolicyScopeSchema.optional(),
  subject: PolicySubjectSchema,
  conditions: PolicyConditionsSchema.optional(),
  effect: PolicyEffectSchema,
  explanation: z.string().optional(),
  precedence: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

export type PolicyObject = z.infer<typeof PolicySchema>;
