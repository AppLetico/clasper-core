import { z } from 'zod';

export interface ExecutionRequest {
  execution_id: string;
  adapter_id: string;
  tenant_id: string;
  workspace_id: string;
  skill_id?: string;
  requested_capabilities: string[];
  estimated_cost?: number;
  intent?: string;
  /** Specific tool being invoked (e.g. "exec", "write_file"). */
  tool?: string;
  /** Tool group / category (e.g. "runtime", "fs", "web"). */
  tool_group?: string;
  /** Skill requesting the tool invocation (e.g. "shell_agent"). */
  skill?: string;
  /** How the intent was derived (e.g. "heuristic"). Assistive signal only. */
  intent_source?: string;
  context?: ExecutionContext;
  provenance?: ExecutionProvenance;
}

export const ExecutionRequestSchema = z.object({
  execution_id: z.string(),
  adapter_id: z.string(),
  tenant_id: z.string(),
  workspace_id: z.string(),
  skill_id: z.string().optional(),
  requested_capabilities: z.array(z.string()),
  estimated_cost: z.number().optional(),
  intent: z.string().optional(),
  /** Specific tool being invoked (e.g. "exec", "write_file"). */
  tool: z.string().optional(),
  /** Tool group / category (e.g. "runtime", "fs", "web"). */
  tool_group: z.string().optional(),
  /** Skill requesting the tool invocation (e.g. "shell_agent"). */
  skill: z.string().optional(),
  /** How the intent was derived (e.g. "heuristic"). Assistive signal only. */
  intent_source: z.string().optional(),
  context: z
    .object({
      external_network: z.boolean().optional(),
      writes_files: z.boolean().optional(),
      elevated_privileges: z.boolean().optional(),
      package_manager: z.string().optional(),
      targets: z.array(z.string()).optional(),
    })
    .optional(),
  provenance: z
    .object({
      source: z.enum(['marketplace', 'internal', 'git', 'unknown']).optional(),
      publisher: z.string().optional(),
      artifact_hash: z.string().optional(),
    })
    .optional(),
});

export interface ExecutionContext {
  external_network?: boolean;
  writes_files?: boolean;
  elevated_privileges?: boolean;
  package_manager?: string;
  targets?: string[];
}

export interface ExecutionProvenance {
  source?: 'marketplace' | 'internal' | 'git' | 'unknown';
  publisher?: string;
  artifact_hash?: string;
}

export interface ExecutionScope {
  capabilities: string[];
  max_steps: number;
  max_cost: number;
  expires_at: string;
}

export const ExecutionScopeSchema = z.object({
  capabilities: z.array(z.string()),
  max_steps: z.number(),
  max_cost: z.number(),
  expires_at: z.string(),
});

export interface ExecutionDecision {
  allowed: boolean;
  execution_id: string;
  granted_scope?: ExecutionScope;
  blocked_reason?: string;
  requires_approval?: boolean;
  decision?: 'allow' | 'deny' | 'require_approval' | 'pending';
  decision_id?: string;
  expires_at?: string;
  required_role?: string;
  matched_policies?: string[];
  /** True when the only matched policy was a fallback rule. */
  policy_fallback_hit?: boolean;
  decision_trace?: {
    policy_id: string;
    result: 'matched' | 'skipped';
    decision?: 'allow' | 'deny' | 'require_approval';
    explanation?: string;
  }[];
  explanation?: string;
  /**
   * The approval handling mode in Core:
   * - simulate: require_approval is auto-allowed (DEV OVERRIDE) with loud audit signals
   * - enforce: require_approval blocks until an operator approves/denies (local, self-attested)
   */
  approval_mode?: 'simulate' | 'enforce';
  /**
   * If approval was simulated, indicates where that auto-allow came from.
   * Intended for UI/audit guardrails so users don't mistake simulation for enforcement.
   */
  approval_source?: 'config_override';
  /** Set when Core (OSS) auto-allowed an execution that would otherwise require approval. */
  auto_allowed_in_core?: boolean;
}

export const ExecutionDecisionSchema = z.object({
  allowed: z.boolean(),
  execution_id: z.string(),
  granted_scope: ExecutionScopeSchema.optional(),
  blocked_reason: z.string().optional(),
  requires_approval: z.boolean().optional(),
  decision: z.enum(['allow', 'deny', 'require_approval', 'pending']).optional(),
  decision_id: z.string().optional(),
  expires_at: z.string().optional(),
  required_role: z.string().optional(),
  matched_policies: z.array(z.string()).optional(),
  policy_fallback_hit: z.boolean().optional(),
  decision_trace: z
    .array(
      z.object({
        policy_id: z.string(),
        result: z.enum(['matched', 'skipped']),
        decision: z.enum(['allow', 'deny', 'require_approval']).optional(),
        explanation: z.string().optional(),
      })
    )
    .optional(),
  explanation: z.string().optional(),
  approval_mode: z.enum(['simulate', 'enforce']).optional(),
  approval_source: z.enum(['config_override']).optional(),
  auto_allowed_in_core: z.boolean().optional(),
});
