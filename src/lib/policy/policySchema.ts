import { z } from 'zod';

export const PolicyDecisionSchema = z.enum(['allow', 'deny', 'require_approval']);
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const PolicyScopeSchema = z.object({
  tenant_id: z.string().optional(),
  workspace_id: z.string().optional(),
  environment: z.string().optional(),
});

export const PolicySubjectSchema = z.object({
  type: z.enum(['adapter', 'tool', 'skill', 'environment', 'risk', 'cost', 'agent']),
  name: z.string().optional(),
});

const ScalarConditionSchema = z.union([z.string(), z.number(), z.boolean()]);

const StringConditionSchema = z.union([
  z.string(),
  z.object({ eq: z.string() }),
  z.object({ in: z.array(z.string()) }),
  z.object({ prefix: z.string() }),
  z.object({ exists: z.literal(true) }),
]);

const BooleanConditionSchema = z.union([
  z.boolean(),
  z.object({ eq: z.boolean() }),
  z.object({ in: z.array(z.boolean()) }),
  z.object({ exists: z.literal(true) }),
]);

const NumberConditionSchema = z.union([
  z.number(),
  z.object({ eq: z.number() }),
  z.object({ in: z.array(z.number()) }),
  z.object({ exists: z.literal(true) }),
]);

const PathArrayConditionSchema = z.union([
  z.object({ all_under: z.array(z.string()) }),
  z.object({ any_under: z.array(z.string()) }),
  z.object({ exists: z.literal(true) }),
]);

export const PolicyConditionOperatorSchema = z.union([
  ScalarConditionSchema,
  z.object({ eq: ScalarConditionSchema }),
  z.object({ in: z.array(ScalarConditionSchema) }),
  z.object({ prefix: z.string() }),
  z.object({ all_under: z.array(z.string()) }),
  z.object({ any_under: z.array(z.string()) }),
  z.object({ exists: z.literal(true) }),
]);

export const PolicyConditionsSchema = z
  .object({
  adapter_risk_class: z.string().optional(),
  tool: StringConditionSchema.optional(),
  /** Tool group / category for broader matching (e.g. "runtime", "fs", "web"). */
  tool_group: StringConditionSchema.optional(),
  skill_state: StringConditionSchema.optional(),
  risk_level: StringConditionSchema.optional(),
  min_cost: z.number().optional(),
  max_cost: z.number().optional(),
  tenant_id: StringConditionSchema.optional(),
  workspace_id: StringConditionSchema.optional(),
  capability: StringConditionSchema.optional(),
  intent: StringConditionSchema.optional(),
  /** Agent identifier for per-agent policy matching. */
  agent_id: StringConditionSchema.optional(),
  /** Agent role for per-agent policy matching. */
  agent_role: StringConditionSchema.optional(),
  /** Generic action (e.g. exec, model.generate). Maps to tool when tool is used. */
  action: StringConditionSchema.optional(),
  /** Generic resource (e.g. command, external_url). */
  resource: StringConditionSchema.optional(),
  /** Actor identifier for generic policy matching. */
  actor: StringConditionSchema.optional(),
  context: z
    .object({
      external_network: BooleanConditionSchema.optional(),
      writes_files: BooleanConditionSchema.optional(),
      elevated_privileges: BooleanConditionSchema.optional(),
      package_manager: StringConditionSchema.optional(),
      exec: z
        .object({
          argv0: StringConditionSchema.optional(),
          argv: z
            .union([z.array(z.string()), z.object({ in: z.array(z.string()) }), z.object({ exists: z.literal(true) })])
            .optional(),
          cwd: StringConditionSchema.optional(),
        })
        .optional(),
      targets: z
        .object({
          paths: PathArrayConditionSchema.optional(),
          hosts: z
            .union([
              z.array(z.string()),
              z.object({ in: z.array(z.string()) }),
              z.object({ exists: z.literal(true) }),
            ])
            .optional(),
        })
        .optional(),
      side_effects: z
        .object({
          writes_possible: BooleanConditionSchema.optional(),
          network_possible: BooleanConditionSchema.optional(),
        })
        .optional(),
    })
    .optional(),
  provenance: z
    .object({
      source: z
        .union([
          z.enum(['marketplace', 'internal', 'git', 'unknown']),
          z.object({
            in: z.array(z.enum(['marketplace', 'internal', 'git', 'unknown'])),
          }),
          z.object({ exists: z.literal(true) }),
        ])
        .optional(),
      publisher: StringConditionSchema.optional(),
    })
    .optional(),
  })
  .passthrough();

export const PolicyEffectSchema = z.object({
  decision: PolicyDecisionSchema,
});

const RESERVED_TOOL_PREFIX = '__clasper_';

function getToolValuesFromPolicy(obj: { subject?: { type?: string; name?: string }; conditions?: Record<string, unknown> }): string[] {
  const out: string[] = [];
  if (obj.subject?.type === 'tool' && obj.subject.name) {
    out.push(obj.subject.name);
  }
  const cond = obj.conditions as Record<string, unknown> | undefined;
  const tool = cond?.tool;
  if (typeof tool === 'string') out.push(tool);
  else if (tool && typeof tool === 'object' && !Array.isArray(tool)) {
    const t = tool as Record<string, unknown>;
    if (typeof t.prefix === 'string') out.push(t.prefix);
    if (Array.isArray(t.in)) {
      for (const v of t.in) {
        if (typeof v === 'string') out.push(v);
      }
    }
  }
  return out;
}

export const PolicySchema = z
  .object({
    policy_id: z.string(),
    scope: PolicyScopeSchema.optional(),
    subject: PolicySubjectSchema,
    conditions: PolicyConditionsSchema.optional(),
    effect: PolicyEffectSchema,
    explanation: z.string().optional(),
    precedence: z.number().int().optional(),
    enabled: z.boolean().optional(),
    _wizard_meta: z.record(z.unknown()).optional(),
    _wizard_meta_hash: z.string().optional(),
  })
  .refine(
    (p) => {
      const tools = getToolValuesFromPolicy(p);
      return !tools.some((t) => t.startsWith(RESERVED_TOOL_PREFIX));
    },
    {
      message: `Tool names starting with "${RESERVED_TOOL_PREFIX}" are reserved for Clasper internal use (e.g. diagnostics). Choose a different tool name.`,
    }
  );

export type PolicyObject = z.infer<typeof PolicySchema>;
