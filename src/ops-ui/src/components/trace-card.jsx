import { ExecutionBadge, GovernanceBadge } from "./badge.jsx";
import { useState } from "preact/hooks";
import { apiPost } from "../api.js";
import { showToast } from "../state.js";
import { TRUST_LABEL, titleCase } from "../labelColors.js";

/**
 * Card for a pending decision when no trace is available (same visual style as TraceCard).
 */
export function PendingDecisionCard({ decision, onClick, onResolved }) {
  const id = decision.execution_id || decision.decision_id;
  const shortId = id ? `${id.slice(0, 8)}…${id.slice(-5)}` : "—";
  
  // Parse snapshot data for rich display
  const snap = decision.request_snapshot || {};
  const req = snap.request || {};
  const res = snap.decision || {};

  // Title: Intent or generic
  const title = req.intent || "Execution Request";

  // Subtitle: Adapter · Env · Tools
  const adapterDisplay = decision.adapter_id || "unknown-adapter";
  const envDisplay = req.environment || "env";
  const roleDisplay = decision.required_role ? `(${decision.required_role})` : "";
  const secondary = `${adapterDisplay} ${roleDisplay} · ${envDisplay} · ${req.tool_count || 0} tools`;

  // Policy & Risk
  const policies = res.matched_policies || [];
  const riskReason = res.blocked_reason || ""; // e.g. "risk_requires_approval:high"
  const isRisk = riskReason.includes("risk");
  const explanation = res.explanation || riskReason;

  const [confirm, setConfirm] = useState(null); // 'approve' | 'deny' | null
  const [busy, setBusy] = useState(false);

  const resolve = async (status) => {
    setBusy(true);
    try {
      await apiPost(`/ops/api/decisions/${decision.decision_id}/resolve`, { status });
      showToast(status === "approved" ? "Approved locally (self-attested)" : "Denied locally (self-attested)", "success");
      setConfirm(null);
      onResolved?.();
    } catch (e) {
      console.error("Resolve decision failed", e);
      showToast("Failed to resolve decision", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      class="detail-block card-item"
      style={{ cursor: onClick ? "pointer" : "default" }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <GovernanceBadge decision="pending_approval" />
        </div>
        <span class="mono text-secondary" style={{ fontSize: "11px" }} title={id}>
          {shortId}
        </span>
      </div>

      <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "6px", lineHeight: "1.5" }}>
        {title}
      </div>

      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>
        {secondary}
      </div>

      {policies.length > 0 && (
        <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px" }}>
          policy: {policies.join(", ")}
        </div>
      )}

      {/* Risk / Explanation section */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--text-secondary)", marginBottom: "12px" }}>
        {isRisk && <span style={{ color: "var(--accent-warn)", fontWeight: 500 }}>⚠️</span>}
        <span style={{ color: isRisk ? "var(--accent-warn)" : "inherit" }}>
          {explanation}
        </span>
      </div>

      <div style={{ display: "flex", gap: "10px" }}>
        <button
          class="btn-primary btn-sm"
          disabled={busy}
          onClick={(e) => { e.stopPropagation(); setConfirm("approve"); }}
        >
          Approve locally
        </button>
        <button
          class="btn-secondary btn-sm"
          disabled={busy}
          onClick={(e) => { e.stopPropagation(); setConfirm("deny"); }}
        >
          Deny locally
        </button>
      </div>

      {/* Modal logic remains the same */}
      <div class={`modal ${confirm ? "" : "hidden"}`} onClick={(e) => e.stopPropagation()}>
        <div class="modal-backdrop" onClick={() => !busy && setConfirm(null)} />
        <div class="modal-dialog" role="dialog" aria-modal="true">
          <div class="modal-header">
            <div style={{ fontWeight: 700 }}>
              {confirm === "approve" ? "Local approval" : "Local denial"}
            </div>
            <button class="btn-ghost btn-sm" disabled={busy} onClick={() => setConfirm(null)}>Close</button>
          </div>
          <div class="modal-body">
            <div class="text-secondary text-sm" style={{ lineHeight: 1.6 }}>
              {confirm === "approve" ? (
                <>
                  This approval is self-attested and intended for local, single-operator use. It does not grant organizational authority or produce audit-grade proof.
                  <div style={{ marginTop: 10 }}>
                    Proceed?
                  </div>
                </>
              ) : (
                <>
                  This denial is self-attested and intended for local, single-operator use. It does not produce audit-grade proof.
                  <div style={{ marginTop: 10 }}>
                    Proceed?
                  </div>
                </>
              )}
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-ghost btn-sm" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
            {confirm === "approve" ? (
              <button class="btn-primary btn-sm" disabled={busy} onClick={() => resolve("approved")}>
                {busy ? "Approving…" : "Approve locally"}
              </button>
            ) : (
              <button class="btn-secondary btn-sm" disabled={busy} onClick={() => resolve("denied")}>
                {busy ? "Denying…" : "Deny locally"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
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
