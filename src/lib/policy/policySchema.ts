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
  /** Tool group / category for broader matching (e.g. "runtime", "fs", "web"). */
  tool_group: z.string().optional(),
  skill_state: z.string().optional(),
  risk_level: z.string().optional(),
  min_cost: z.number().optional(),
  max_cost: z.number().optional(),
  tenant_id: z.string().optional(),
  workspace_id: z.string().optional(),
  capability: z.string().optional(),
  intent: z.string().optional(),
  context: z
    .object({
      external_network: z.boolean().optional(),
      writes_files: z.boolean().optional(),
      elevated_privileges: z.boolean().optional(),
      package_manager: z.string().optional(),
    })
    .optional(),
  provenance: z
    .object({
      source: z.enum(['marketplace', 'internal', 'git', 'unknown']).optional(),
      publisher: z.string().optional(),
    })
    .optional(),
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
