const RISK_MAP = { critical: "warn", high: "warn", medium: "warn" };
const EXECUTION_MAP = { success: "success", error: "warn" };
const GOV_MAP = { allow: "success", deny: "danger", pending_approval: "warn", approved_local: "info", unknown: "" };

export function Badge({ text, kind, tooltip }) {
  return <span class={`badge-pill ${kind || ""}`} data-tooltip={tooltip}>{text || "-"}</span>;
}

export function RiskBadge({ level, tooltip }) {
  const t = tooltip || `Risk Level: ${level}`;
  return <Badge text={level || "-"} kind={RISK_MAP[level]} tooltip={t} />;
}

export function ExecutionBadge({ status, tooltip }) {
  const t = tooltip || `Execution: ${status}`;
  return <Badge text={status || "-"} kind={EXECUTION_MAP[status]} tooltip={t} />;
}

export function GovernanceBadge({ decision, tooltip }) {
  const text =
    decision === "pending_approval" ? "Needs approval" :
    decision === "approved_local" ? "Local approval (untrusted)" :
    decision === "deny" ? "Blocked" :
    decision === "allow" ? "Approved" :
    "Unknown";
  const t = tooltip || `Governance: ${text}`;
  return <Badge text={text} kind={GOV_MAP[decision]} tooltip={t} />;
}

// Deprecated: migrate to ExecutionBadge or GovernanceBadge
export function StatusBadge({ status, tooltip }) {
  return <ExecutionBadge status={status} tooltip={tooltip} />;
}
