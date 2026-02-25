import { createHash } from "node:crypto";
import type { WizardAuditMeta } from "./auditLog.js";

export const WIZARD_META_VERSION = 1;
export const WIZARD_WARNING_IDS = [
  "broad_scope",
  "high_risk_allow_attempt",
  "missing_path_scope",
  "missing_command_scope",
  "prefix_operator_broad",
] as const;

const WIZARD_WARNING_ID_SET = new Set<string>(WIZARD_WARNING_IDS);

export function normalizeOutcomeFromDecision(decision: unknown): "allow" | "require_approval" | "deny" {
  if (decision === "allow" || decision === "deny" || decision === "require_approval") {
    return decision;
  }
  return "require_approval";
}

export function normalizeWizardMeta(params: {
  input: unknown;
  fallbackOutcome: "allow" | "require_approval" | "deny";
  tenantId: string;
  workspaceId?: string;
  actorUserId?: string;
  previousMeta?: WizardAuditMeta | null;
  isEdit?: boolean;
}): WizardAuditMeta | null {
  if (!params.input || typeof params.input !== "object" || Array.isArray(params.input)) {
    return null;
  }

  const raw = params.input as Record<string, unknown>;
  let invalid = false;

  const createdViaWizardRaw = raw.created_via_wizard;
  let createdViaWizard = true;
  if (typeof createdViaWizardRaw === "boolean") {
    createdViaWizard = createdViaWizardRaw;
    if (!createdViaWizardRaw) invalid = true;
  } else if (createdViaWizardRaw !== undefined) {
    invalid = true;
  }

  const selectedOutcomeRaw = raw.selected_outcome;
  let selectedOutcome: "allow" | "require_approval" | "deny" = params.fallbackOutcome;
  if (selectedOutcomeRaw === "allow" || selectedOutcomeRaw === "require_approval" || selectedOutcomeRaw === "deny") {
    selectedOutcome = selectedOutcomeRaw;
  } else if (selectedOutcomeRaw !== undefined) {
    invalid = true;
  }

  const scopeRaw = raw.scope_choice;
  let scopeChoice: "workspace" | "custom_path_scope" | "global" = params.workspaceId ? "workspace" : "global";
  if (scopeRaw === "workspace" || scopeRaw === "custom_path_scope" || scopeRaw === "global") {
    scopeChoice = scopeRaw;
  } else if (scopeRaw === "custom") {
    scopeChoice = "custom_path_scope";
  } else if (scopeRaw !== undefined) {
    invalid = true;
  }

  const commandRaw = raw.command_match_choice;
  let commandMatchChoice: "single" | "list" | "none" = "none";
  if (commandRaw === "single" || commandRaw === "list" || commandRaw === "none") {
    commandMatchChoice = commandRaw;
  } else if (commandRaw === "this_command") {
    commandMatchChoice = "single";
  } else if (commandRaw === "custom_list") {
    commandMatchChoice = "list";
  } else if (commandRaw !== undefined) {
    invalid = true;
  }

  let warningsShown: string[] = [];
  if (Array.isArray(raw.warnings_shown)) {
    const normalized = raw.warnings_shown.filter((w): w is string => typeof w === "string");
    warningsShown = normalized.filter((w) => WIZARD_WARNING_ID_SET.has(w));
    if (warningsShown.length !== normalized.length) invalid = true;
  } else if (raw.warnings_shown !== undefined) {
    invalid = true;
  }

  const ackRaw = raw.wizard_acknowledged_allow;
  let wizardAcknowledgedAllow = false;
  if (typeof ackRaw === "boolean") {
    wizardAcknowledgedAllow = ackRaw;
  } else if (ackRaw !== undefined) {
    invalid = true;
  }
  if (selectedOutcome === "allow" && wizardAcknowledgedAllow !== true) {
    invalid = true;
    wizardAcknowledgedAllow = false;
  }

  const attestedAt = new Date().toISOString();
  const previousMeta = params.previousMeta ?? null;
  const isEdit = params.isEdit === true;
  return {
    wizard_meta_version: WIZARD_META_VERSION,
    created_via_wizard: previousMeta?.created_via_wizard ?? createdViaWizard,
    selected_outcome: selectedOutcome,
    scope_choice: scopeChoice,
    command_match_choice: commandMatchChoice,
    warnings_shown: warningsShown,
    wizard_acknowledged_allow: wizardAcknowledgedAllow,
    wizard_meta_invalid: invalid,
    wizard_meta_attested: true,
    attested_by: "core",
    attested_at: attestedAt,
    actor_user_id: previousMeta?.actor_user_id ?? params.actorUserId ?? null,
    tenant_id: params.tenantId,
    workspace_id: params.workspaceId ?? null,
    edited_via_wizard: isEdit || previousMeta?.edited_via_wizard === true,
    last_edited_at: isEdit ? attestedAt : previousMeta?.last_edited_at,
    last_edited_by: isEdit ? (params.actorUserId ?? null) : previousMeta?.last_edited_by,
  };
}

export function isUnsafeAllowWizardMeta(meta: WizardAuditMeta | null): boolean {
  if (!meta) return false;
  return meta.selected_outcome === "allow" && meta.wizard_acknowledged_allow !== true;
}

export function buildPolicySummaryForAudit(record: Record<string, unknown>): Record<string, unknown> {
  const conditions =
    record.conditions && typeof record.conditions === "object" && !Array.isArray(record.conditions)
      ? (record.conditions as Record<string, unknown>)
      : {};
  const keyConditions: Record<string, unknown> = {};
  if (conditions.tool !== undefined) keyConditions.tool = conditions.tool;
  if (conditions.tool_group !== undefined) keyConditions.tool_group = conditions.tool_group;
  if (conditions["context.exec.argv0"] !== undefined) {
    keyConditions["context.exec.argv0"] = conditions["context.exec.argv0"];
  }
  if (conditions["context.targets.paths"] !== undefined) {
    keyConditions["context.targets.paths"] = conditions["context.targets.paths"];
  }
  return {
    policy_id: typeof record.policy_id === "string" ? record.policy_id : null,
    effect:
      record.effect && typeof record.effect === "object"
        ? (record.effect as Record<string, unknown>).decision ?? null
        : null,
    precedence: typeof record.precedence === "number" ? record.precedence : null,
    scope: {
      tenant_id: typeof record.tenant_id === "string" ? record.tenant_id : null,
      workspace_id: typeof record.workspace_id === "string" ? record.workspace_id : null,
    },
    key_conditions: keyConditions,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      out[key] = canonicalize(input[key]);
    }
    return out;
  }
  return value;
}

export function hashWizardMetaAttestation(params: {
  wizardMeta: WizardAuditMeta;
  policySummary?: Record<string, unknown>;
}): string {
  const canonicalPayload = canonicalize({
    wizard_meta: params.wizardMeta,
    policy_summary: params.policySummary ?? null,
  });
  const serialized = JSON.stringify(canonicalPayload);
  return createHash("sha256").update(serialized).digest("hex");
}

export function hashPolicySummary(policySummary: Record<string, unknown>): string {
  const serialized = JSON.stringify(canonicalize(policySummary));
  return createHash("sha256").update(serialized).digest("hex");
}
