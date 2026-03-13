import { RISK_KIND, RISK_LABEL, EXECUTION_KIND, EXECUTION_LABEL, GOV_KIND, GOV_LABEL, titleCase } from "../labelColors.js";

export function Badge({ text, kind, tooltip }) {
  return <span class={`badge-pill ${kind || ""}`} data-tooltip={tooltip}>{text || "-"}</span>;
}

export function RiskBadge({ level, tooltip }) {
  const display = RISK_LABEL[level] ?? titleCase(level);
  const t = tooltip || `Risk Level: ${display}`;
  return <Badge text={display || "-"} kind={RISK_KIND[level]} tooltip={t} />;
}

export function ExecutionBadge({ status, tooltip }) {
  const display = EXECUTION_LABEL[status] ?? titleCase(status);
  const t = tooltip || `Execution: ${display}`;
  return <Badge text={display || "-"} kind={EXECUTION_KIND[status]} tooltip={t} />;
}

export function GovernanceBadge({ decision, tooltip }) {
  const text = GOV_LABEL[decision] ?? "Unknown";
  const t = tooltip || `Governance: ${text}`;
  return <Badge text={text} kind={GOV_KIND[decision]} tooltip={t} />;
}

// Deprecated: migrate to ExecutionBadge or GovernanceBadge
export function StatusBadge({ status, tooltip }) {
  return <ExecutionBadge status={status} tooltip={tooltip} />;
}
