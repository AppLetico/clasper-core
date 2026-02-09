import { calculateRiskScore } from "../governance/riskScoring.js";
import { getAdapterRegistry } from "../adapters/registry.js";
import { getSkillRegistry, type SkillState } from "../skills/skillRegistry.js";
import type { AgentTrace, TraceStep } from "../tracing/trace.js";
import type { OpsRole } from "../auth/opsAuth.js";
import { config } from "../core/config.js";
import type { GovernanceView } from "./governanceViews.js";

/**
 * Role hierarchy rank for comparison
 */
const ROLE_RANK: Record<OpsRole, number> = {
  viewer: 1,
  operator: 2,
  release_manager: 3,
  admin: 4
};

/**
 * Check if role meets minimum threshold
 */
function roleAtLeast(role: OpsRole, minimumRole: OpsRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimumRole];
}

/**
 * Placeholder text for withheld sensitive content
 */
const SENSITIVE_CONTENT_PLACEHOLDER = "[Sensitive content withheld]";

export interface TraceSummaryView {
  id: string;
  tenant_id: string;
  workspace_id: string;
  agent_role?: string;
  adapter_id?: string;
  environment: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  status: "success" | "error";
  model: string;
  provider: string;
  cost: number;
  story_summary: string;
  tokens: {
    input: number;
    output: number;
  };
  risk: {
    score: number;
    level: string;
    factors: string[];
  };
  deprecated_skill_used: boolean;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  integrity: {
    status: string;
    failures: string[];
  };
  trust_status: string;
  requested_capabilities: string[];
  tool_count: number;
  tool_names: string[];
  governance?: GovernanceView;
}

/**
 * Redaction information for trace detail
 */
export interface RedactionInfo {
  applied: boolean;
  types_detected: string[];
  count: number;
}

/**
 * Linked identifier with optional deep link URL
 */
export interface LinkedId {
  value: string | null;
  url: string | null;
}

export interface TraceDetailView extends TraceSummaryView {
  input: {
    message: string;
    message_history: number;
  };
  output?: {
    message: string;
    tool_calls: {
      id: string;
      name: string;
      duration_ms: number;
      permitted: boolean;
      success: boolean;
    }[];
  };
  steps: {
    type: string;
    timestamp: string;
    duration_ms: number;
    data: unknown;
  }[];
  skill_versions: Record<string, string>;
  skill_states: Record<string, string>;
  governance_signals: {
    redaction_applied: boolean;
    permission_denials: {
      tool_name: string;
      reason?: string;
    }[];
  };
  redaction_info: RedactionInfo;
  linked_ids: {
    task_id: LinkedId;
    document_id: LinkedId;
    message_id: LinkedId;
  };
  granted_scope?: {
    capabilities: string[];
    max_steps: number;
    max_cost: number;
  };
  used_scope?: {
    capabilities: string[];
    step_count: number;
    actual_cost: number;
  };
  violations?: {
    type: string;
    message: string;
    timestamp: string;
  }[];
  raw_trace: AgentTrace | null;
}

function deriveEnvironment(trace: AgentTrace): string {
  const labels = trace.labels || {};
  return labels.environment || labels.env || "unknown";
}

function getToolNames(steps: TraceStep[]): string[] {
  return steps
    .filter((step) => step.type === "tool_call")
    .map((step) => (step.data as { toolName?: string }).toolName)
    .filter((name): name is string => !!name);
}

function getPermissionDenials(steps: TraceStep[]) {
  return steps
    .filter((step) => step.type === "tool_call")
    .map((step) => step.data as { toolName: string; permitted: boolean; permissionReason?: string })
    .filter((data) => data.permitted === false)
    .map((data) => ({
      tool_name: data.toolName,
      reason: data.permissionReason
    }));
}

function getSkillStates(skillVersions: Record<string, string>): Record<string, string> {
  const registry = getSkillRegistry();
  const states: Record<string, string> = {};
  for (const [name, version] of Object.entries(skillVersions)) {
    const skill = registry.getAnyState(name, version);
    if (skill) {
      states[name] = skill.state;
    }
  }
  return states;
}

function hasDeprecatedSkill(skillStates: Record<string, string>): boolean {
  return Object.values(skillStates).some((state) => state === "deprecated");
}

function pickSkillStateForRisk(skillStates: Record<string, string>): string | undefined {
  const priority: Record<string, number> = {
    draft: 5,
    deprecated: 4,
    tested: 3,
    approved: 2,
    active: 1
  };
  let best: { state: string; score: number } | null = null;
  for (const state of Object.values(skillStates)) {
    const score = priority[state] || 0;
    if (!best || score > best.score) {
      best = { state, score };
    }
  }
  return best?.state;
}

export function computeTraceRisk(trace: AgentTrace, skillStates?: Record<string, string>) {
  const states = skillStates || getSkillStates(trace.skillVersions);
  const toolNames = getToolNames(trace.steps);
  const requestedCapabilities = trace.granted_scope?.capabilities;
  const adapterRiskClass = trace.adapter_id
    ? (getAdapterRegistry().get(trace.tenantId, trace.adapter_id)?.risk_class as any)
    : undefined;

  const context =
    requestedCapabilities?.includes("external_network")
      ? { external_network: true }
      : undefined;

  const score = calculateRiskScore({
    toolCount: toolNames.length,
    toolNames,
    skillState: pickSkillStateForRisk(states) as SkillState | undefined,
    model: trace.model,
    dataSensitivity: "none",
    adapterRiskClass,
    requestedCapabilities,
    context
  });

  return {
    score: score.score,
    level: score.level,
    factors: score.riskFactors
  };
}

function buildAnnotationsMap(entries: { key: string; value: string }[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of entries) {
    if (!map[entry.key]) {
      map[entry.key] = entry.value;
    }
  }
  return map;
}

function shortList(items: string[], max: number): string {
  const shown = items.slice(0, max);
  const more = items.length > max ? ` +${items.length - max}` : "";
  return `${shown.join(", ")}${more}`;
}

function buildStorySummary(params: {
  trace: AgentTrace;
  environment: string;
  annotations: Record<string, string>;
  requestedCapabilities: string[];
  toolNames: string[];
  governance?: GovernanceView;
}) {
  const scenario = (params.trace.labels || {}).scenario || params.annotations.scenario || "trace";
  const ticket = params.annotations.ticket;
  const repo = params.annotations.repo;
  const service = params.annotations.service;
  const version = params.annotations.version;
  const intent = (params.trace.labels || {}).intent || params.annotations.intent;

  // Primary story line: What was the agent trying to do?
  // Prefer human-readable intent if available, otherwise construct from scenario
  let title = intent || scenario;
  if (!intent) {
    if (scenario === "incident_triage") {
      title = `Triage ${ticket || "incident"}`;
      if (repo) title += ` (${repo})`;
    } else if (scenario === "deploy") {
      title = `Deploy ${service || "service"}${version ? ` ${version}` : ""}`;
    } else if (scenario === "config_change") {
      title = `Config change ${service || "service"}`;
    } else if (scenario === "data_access") {
      title = "Access sensitive data";
    } else {
      title = scenario.replace(/_/g, " ");
      // Capitalize first letter
      title = title.charAt(0).toUpperCase() + title.slice(1);
    }
  }

  return title;
}

export function buildTraceSummaryView(params: {
  trace: AgentTrace;
  annotations: { key: string; value: string }[];
  governance?: GovernanceView;
}): TraceSummaryView {
  const { trace, annotations, governance } = params;
  const skillStates = getSkillStates(trace.skillVersions);
  const risk = computeTraceRisk(trace, skillStates);
  const labels = trace.labels || {};
  const toolNames = getToolNames(trace.steps);
  const requestedCapabilities = trace.granted_scope?.capabilities || [];
  const annotationsMap = buildAnnotationsMap(annotations);
  const environment = deriveEnvironment(trace);
  const storySummary = buildStorySummary({
    trace,
    environment,
    annotations: annotationsMap,
    requestedCapabilities,
    toolNames,
    governance
  });

  return {
    id: trace.id,
    tenant_id: trace.tenantId,
    workspace_id: trace.workspaceId,
    agent_role: trace.agentRole,
    adapter_id: trace.adapter_id,
    environment,
    started_at: trace.startedAt,
    completed_at: trace.completedAt,
    duration_ms: trace.durationMs,
    status: trace.error ? "error" : "success",
    model: trace.model,
    provider: trace.provider,
    cost: trace.usage.totalCost,
    story_summary: storySummary,
    tokens: {
      input: trace.usage.inputTokens,
      output: trace.usage.outputTokens
    },
    risk,
    deprecated_skill_used: hasDeprecatedSkill(skillStates),
    labels,
    annotations: annotationsMap,
    integrity: {
      status: trace.integrity_status || "unverified",
      failures: trace.integrity_failures || []
    },
    trust_status: trace.trust_status || "unverified",
    requested_capabilities: requestedCapabilities,
    tool_count: toolNames.length,
    tool_names: toolNames,
    governance
  };
}

/**
 * Detect redaction types from redacted prompt content
 */
function detectRedactionTypes(redactedPrompt: string | undefined): string[] {
  if (!redactedPrompt) return [];

  const types: string[] = [];
  const lowerContent = redactedPrompt.toLowerCase();

  if (lowerContent.includes("[email]") || lowerContent.includes("email redacted")) {
    types.push("email");
  }
  if (lowerContent.includes("[ssn]") || lowerContent.includes("ssn redacted")) {
    types.push("ssn");
  }
  if (lowerContent.includes("[phone]") || lowerContent.includes("phone redacted")) {
    types.push("phone");
  }
  if (lowerContent.includes("[address]") || lowerContent.includes("address redacted")) {
    types.push("address");
  }
  if (lowerContent.includes("[credit_card]") || lowerContent.includes("card redacted")) {
    types.push("credit_card");
  }
  if (lowerContent.includes("[name]") || lowerContent.includes("name redacted")) {
    types.push("name");
  }
  if (lowerContent.includes("[redacted]")) {
    types.push("other");
  }

  return types;
}

/**
 * Count redaction occurrences in content
 */
function countRedactions(redactedPrompt: string | undefined): number {
  if (!redactedPrompt) return 0;
  const matches = redactedPrompt.match(/\[[\w_]+\]/g) || [];
  return matches.length;
}

/**
 * Build deep link URL from template
 */
function buildDeepLinkUrl(template: string | undefined, id: string | null): string | null {
  if (!template || !id) return null;
  return template.replace("{id}", id);
}

export function buildTraceDetailView(params: {
  trace: AgentTrace;
  annotations: { key: string; value: string }[];
  role?: OpsRole;
  governance?: GovernanceView;
}): TraceDetailView {
  // In OSS Core, Ops Console is single-tenant and the local operator is the admin boundary.
  // Default role to "operator" so detail views are useful out of the box.
  const { trace, annotations, role = "operator", governance } = params;
  const skillStates = getSkillStates(trace.skillVersions);
  const summary = buildTraceSummaryView({ trace, annotations, governance });

  // Role-based stripping (kept for forward-compat with Cloud multi-role setups).
  // For local Core, allow operators to see full trace detail.
  const canSeeSensitive = roleAtLeast(role, "operator");
  const canSeeRaw = roleAtLeast(role, "admin");

  // Get redaction info
  const redactionInfo: RedactionInfo = {
    applied: !!trace.redactedPrompt,
    types_detected: detectRedactionTypes(trace.redactedPrompt),
    count: countRedactions(trace.redactedPrompt)
  };

  // Build linked IDs with deep link URLs
  const taskId = (trace as any).taskId || null;
  const documentId = (trace as any).documentId || null;
  const messageId = (trace as any).messageId || null;

  // Get deep link templates from config (will be added)
  const deepLinkTask = process.env.DEEP_LINK_TASK_TEMPLATE;
  const deepLinkDoc = process.env.DEEP_LINK_DOC_TEMPLATE;
  const deepLinkMsg = process.env.DEEP_LINK_MSG_TEMPLATE;

  const linkedIds = {
    task_id: {
      value: taskId,
      url: buildDeepLinkUrl(deepLinkTask, taskId)
    },
    document_id: {
      value: documentId,
      url: buildDeepLinkUrl(deepLinkDoc, documentId)
    },
    message_id: {
      value: messageId,
      url: buildDeepLinkUrl(deepLinkMsg, messageId)
    }
  };

  // Strip sensitive data for non-privileged users
  const inputMessage = canSeeSensitive ? trace.input.message : SENSITIVE_CONTENT_PLACEHOLDER;
  const outputMessage = canSeeSensitive
    ? trace.output?.message
    : trace.output ? SENSITIVE_CONTENT_PLACEHOLDER : undefined;

  // Strip step data for non-privileged users
  const steps = trace.steps.map((step) => ({
    type: step.type,
    timestamp: step.timestamp,
    duration_ms: step.durationMs,
    data: canSeeSensitive ? step.data : { type: step.type, withheld: true }
  }));

  return {
    ...summary,
    input: {
      message: inputMessage,
      message_history: trace.input.messageHistory
    },
    output: trace.output
      ? {
          message: outputMessage!,
          tool_calls: trace.output.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            duration_ms: tc.durationMs,
            permitted: tc.permitted,
            success: tc.success
          }))
        }
      : undefined,
    steps,
    skill_versions: trace.skillVersions,
    skill_states: skillStates,
    governance_signals: {
      redaction_applied: !!trace.redactedPrompt,
      permission_denials: getPermissionDenials(trace.steps)
    },
    redaction_info: redactionInfo,
    linked_ids: linkedIds,
    granted_scope: trace.granted_scope,
    used_scope: trace.used_scope,
    violations: trace.violations,
    raw_trace: canSeeRaw ? trace : null
  };
}
