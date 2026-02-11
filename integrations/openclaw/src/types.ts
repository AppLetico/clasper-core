/**
 * Shared types for the Clasper × OpenClaw governance plugin.
 */

// ---------------------------------------------------------------------------
// OpenClaw plugin API surface (subset used by the governance shim)
// ---------------------------------------------------------------------------

export interface OpenClawTool {
  name: string;
  group?: string;
  description?: string;
}

export interface OpenClawPluginApi {
  /** Register a tool-dispatch interceptor that wraps every tool invocation. */
  interceptToolDispatch?(
    interceptor: ToolDispatchInterceptor
  ): void;

  /** Register a gateway RPC method. */
  registerGatewayMethod?(name: string, handler: (...args: unknown[]) => unknown): void;

  /** Global OpenClaw config (not plugin-specific). */
  config?: Record<string, unknown>;

  /** Plugin configuration from openclaw.json → plugins.entries.<id>.config */
  pluginConfig?: PluginConfig | Record<string, unknown>;

  /** Logger provided by the gateway. */
  log: LogFn;

  /**
   * Plugin lifecycle hooks (OpenClaw 2026.x API).
   * Used as compatibility fallback when interceptToolDispatch is unavailable.
   */
  on?: (
    hookName: string,
    handler: (event: Record<string, unknown>, context: Record<string, unknown>) => unknown | Promise<unknown>,
    opts?: { priority?: number }
  ) => void;
}

export type ToolDispatchInterceptor = (
  tool: OpenClawTool,
  args: Record<string, unknown>,
  context: ToolInvocationContext,
  next: (tool: OpenClawTool, args: Record<string, unknown>) => Promise<unknown>
) => Promise<unknown>;

export interface ToolInvocationContext {
  sessionId?: string;
  skill?: string;
  [key: string]: unknown;
}

export interface PluginConfig {
  clasperUrl: string;
  adapterId?: string;
  adapterSecret?: string;
  approvalWaitTimeoutMs?: number;
  approvalPollIntervalMs?: number;
  executionReuseWindowMs?: number;
}

export type LogFn = (message: string, ...args: unknown[]) => void;

// ---------------------------------------------------------------------------
// Clasper adapter contract types (mirrors clasper-core)
// ---------------------------------------------------------------------------

export interface AdapterRegistration {
  adapter_id: string;
  display_name: string;
  risk_class: 'low' | 'medium' | 'high' | 'critical';
  capabilities: string[];
  version: string;
  enabled: boolean;
}

export interface ExecutionRequest {
  execution_id: string;
  adapter_id: string;
  tenant_id: string;
  workspace_id: string;
  requested_capabilities: string[];
  tool?: string;
  tool_group?: string;
  skill?: string;
  intent?: string;
  intent_source?: string;
  estimated_cost?: number;
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
}

export type DecisionEffect = 'allow' | 'deny' | 'require_approval' | 'pending';

export interface ExecutionDecision {
  allowed: boolean;
  execution_id: string;
  decision?: DecisionEffect;
  decision_id?: string;
  granted_scope?: {
    capabilities: string[];
    max_steps: number;
    max_cost: number;
    expires_at: string;
  };
  blocked_reason?: string;
  requires_approval?: boolean;
  matched_policies?: string[];
  decision_trace?: {
    policy_id: string;
    result: 'matched' | 'skipped';
    decision?: string;
    explanation?: string;
  }[];
  explanation?: string;
  auto_allowed_in_core?: boolean;
}

export interface DecisionStatusResponse {
  execution_id: string;
  effect: DecisionEffect;
  decision_id: string;
  approval_type: 'local' | 'cloud' | null;
}

export interface AuditEventIngest {
  tenant_id: string;
  workspace_id: string;
  execution_id: string;
  trace_id: string;
  adapter_id: string;
  event_type: string;
  message?: string;
  event_data?: Record<string, unknown>;
  occurred_at: string;
}

export interface TraceIngest {
  tenant_id: string;
  workspace_id: string;
  execution_id: string;
  trace_id: string;
  adapter_id: string;
  trace: Record<string, unknown>;
}

export interface CostMetricIngest {
  tenant_id: string;
  workspace_id: string;
  execution_id: string;
  trace_id: string;
  adapter_id: string;
  cost_usd: number;
  input_tokens?: number;
  output_tokens?: number;
  model?: string;
  provider?: string;
  recorded_at: string;
}
