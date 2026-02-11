import { ExecutionBadge, GovernanceBadge } from "./badge.jsx";
import { useState } from "preact/hooks";
import { apiPost } from "../api.js";
import { showToast } from "../state.js";
import { TRUST_LABEL, titleCase } from "../labelColors.js";

/**
 * Card for a pending decision when no trace is available (same visual style as TraceCard).
 */
// No export needed if logic moved to drawer, or keep for other views if shared
export function PendingDecisionCard({ decision, onClick, onResolved }) {
  // ... kept for backward compatibility if needed, but unused in new flow
  return null; 
}

/**
 * Format card title from trace (story summary or annotations).
 */
export function formatCardTitle(t) {
  return t.story_summary || t.annotations?.summary || t.annotations?.intent || t.labels?.intent || "—";
}

/**
 * Format card secondary line (agent · scenario · adapter).
 */
export function formatCardSecondary(t) {
  const agentName = t.labels?.agent_id;
  const role = t.agent_role || "Unknown Role";
  const agentDisplay = agentName ? `${agentName} (${role})` : role;
  const scenario = t.annotations?.ticket || t.annotations?.repo || t.labels?.scenario || t.annotations?.scenario || "Unknown Scenario";
  const adapter = t.adapter_id || "unknown-adapter";
  return `${agentDisplay} · ${scenario} · ${adapter}`;
}

/**
 * Shared trace/approval card used on Dashboard (high-risk traces) and Approvals page.
 * @param {object} trace - Trace summary from API (id, governance, status, story_summary, etc.)
 * @param {() => void} [onClick] - Optional click handler (e.g. open trace drawer)
 */
export function TraceCard({ trace, onClick }) {
  const decision = trace.governance?.decision || "unknown";
  const showExecutionBadge = decision === "allow";

  return (
    <div
      class="detail-block card-item"
      style={{ cursor: onClick ? "pointer" : "default" }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <GovernanceBadge decision={decision} />
          {showExecutionBadge && <ExecutionBadge status={trace.status} />}
        </div>
        <span class="mono text-secondary" style={{ fontSize: "11px" }} title={trace.id}>
          {trace.id ? `${trace.id.slice(0, 8)}…${trace.id.slice(-5)}` : "-"}
        </span>
      </div>

      <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "6px", lineHeight: "1.5" }}>
        {formatCardTitle(trace)}
      </div>

      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>
        {formatCardSecondary(trace)}
      </div>

      {(trace.governance?.policy_ids || []).length > 0 && (
        <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px" }}>
          policy: {(trace.governance.policy_ids || []).join(", ")}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "var(--text-secondary)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {(trace.risk?.factors || []).length > 0 && (
            <span style={{ color: "var(--accent-warn)", fontWeight: 500 }}>
              ⚠️ {(trace.risk.factors || [])[0]} {(trace.risk.factors || []).length > 1 ? `+${(trace.risk.factors || []).length - 1}` : ""}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px", opacity: 0.8 }}>
          <span title={`Trust: ${trace.trust_status || "unknown"}`}>🛡️ {TRUST_LABEL[trace.trust_status] ?? titleCase(trace.trust_status || "unknown")}</span>
        </div>
      </div>
    </div>
  );
}
