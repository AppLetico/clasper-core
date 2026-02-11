import { useEffect, useState } from "preact/hooks";
import { tenantId, selectedWorkspace, showToast, pendingApprovalsCount } from "../state.js";
import { api, apiPost, buildParams, refreshPendingApprovalsCount } from "../api.js";
import { HelpCircleIcon, XIcon } from "../components/icons.jsx";
import { GovernanceBadge } from "../components/badge.jsx";

export function ApprovalsView() {
  const [decisions, setDecisions] = useState(null);
  const [selectedDecision, setSelectedDecision] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

  const load = async () => {
    try {
      const data = await api(`/ops/api/decisions?${buildParams({ status: "pending" })}`);
      const pending = data.decisions || [];
      setDecisions(pending);
      pendingApprovalsCount.value = pending.length;
    } catch {
      setDecisions([]);
      pendingApprovalsCount.value = 0;
    }
  };

  useEffect(() => { load(); }, [tenantId.value, selectedWorkspace.value]);

  const openDrawer = (d) => setSelectedDecision(d);
  const closeDrawer = () => setSelectedDecision(null);

  const handleResolve = async (decisionId, status) => {
    try {
      await apiPost(`/ops/api/decisions/${decisionId}/resolve`, { 
        status, 
        note: "Resolved via Ops Console" 
      });
      showToast(status === "approved" ? "Approved locally" : "Denied locally", "success");
      closeDrawer();
      load();
      refreshPendingApprovalsCount();
    } catch (e) {
      console.error("Resolve failed", e);
      showToast(e.message || "Failed to resolve decision", "error");
    }
  };

  return (
    <section>
      <div class="panel">
        <div class="panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 data-tooltip="Pending decisions are execution requests paused by governance policies that require human input.">Pending Decisions</h3>
            <button 
              class="btn-icon" 
              onClick={() => setShowHelp(!showHelp)} 
              title="Toggle help"
              style={{ color: showHelp ? "var(--text-primary)" : "var(--text-secondary)" }}
            >
              <HelpCircleIcon width={20} strokeWidth={3} />
            </button>
          </div>
          <button class="btn-secondary btn-sm" onClick={load}>Refresh Queue</button>
        </div>

        {showHelp && (
          <div style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-subtle)" }}>
            <p class="text-secondary text-sm" style={{ lineHeight: "1.5", margin: 0 }}>
              Pending decisions represent execution requests paused by governance policies that require human input.
            </p>
            <p class="text-secondary text-sm" style={{ lineHeight: "1.5", margin: "8px 0 0 0" }}>
              Clasper Core supports local approvals for single-operator workflows. These approvals are self-attested and not externally verifiable.
            </p>
          </div>
        )}

        <div class="panel-list">
          {decisions === null && <div class="empty-state"><div class="spinner" /></div>}
          {decisions && !decisions.length && (
            <div class="empty-state"><div class="empty-icon">✓</div><div>No pending approvals</div></div>
          )}
          {decisions && decisions.length > 0 && (
            <div class="list-group">
              {decisions.map((d) => (
                <DecisionRow key={d.decision_id} decision={d} onClick={() => openDrawer(d)} />
              ))}
            </div>
          )}
        </div>
      </div>

      <DecisionDrawer 
        decision={selectedDecision} 
        onClose={closeDrawer} 
        onResolve={handleResolve} 
      />
    </section>
  );
}

function DecisionRow({ decision, onClick }) {
  const req = decision.request_snapshot || {};
  const r = req.request || {};
  
  const tool = r.tool || (Array.isArray(r.requested_capabilities) ? r.requested_capabilities[0] : "unknown");
  const target = (r.context?.targets || [])[0];
  const intent = r.intent;
  
  // Format timestamp
  const ts = decision.created_at ? new Date(decision.created_at).toLocaleTimeString() : "";

  return (
    <div 
      class="detail-block card-item" 
      onClick={onClick}
      style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
          <GovernanceBadge decision="pending_approval" />
          <strong style={{ fontSize: "14px", color: "var(--text-primary)" }}>
            {tool} {target ? <span class="text-secondary" style={{ fontWeight: 400 }}>on {target}</span> : ""}
          </strong>
        </div>
        <div class="text-secondary text-xs" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {decision.adapter_id}
          {intent && intent !== "unknown" ? ` · ${intent}` : " · Intent not specified"}
        </div>
      </div>
      
      <div class="text-secondary text-xs mono" style={{ flexShrink: 0 }}>
        {ts}
        <span style={{ marginLeft: "12px", opacity: 0.5 }}>→</span>
      </div>
    </div>
  );
}

function DecisionDrawer({ decision, onClose, onResolve }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'approve' | 'deny' | null

  if (!decision) return <div class="drawer"><div class="drawer-backdrop" /></div>;

  const req = decision.request_snapshot || {};
  const r = req.request || {};
  const pol = req.decision || {};
  const intentText = r.intent && r.intent !== "unknown" ? r.intent : null;
  
  const resolve = async (status) => {
    setBusy(true);
    await onResolve(decision.decision_id, status);
    setBusy(false);
    setConfirm(null);
  };

  return (
    <>
      <div class={`drawer ${decision ? "open" : ""}`}>
        <div class="drawer-header">
          <h3>Decision Request</h3>
          <button class="btn-icon" onClick={onClose}><XIcon /></button>
        </div>
        <div class="drawer-body">
          
          <div class="detail-block">
            <div class="detail-row">
              <span class="detail-label">Tool</span>
              <span class="mono" style={{ fontWeight: 600 }}>{r.tool || "—"}</span>
            </div>
            {r.tool_group && (
              <div class="detail-row">
                <span class="detail-label">Group</span>
                <span class="mono">{r.tool_group}</span>
              </div>
            )}
            <div class="detail-row">
              <span class="detail-label">Target</span>
              <span class="mono">{(r.context?.targets || []).join(", ") || "—"}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Adapter</span>
              <span class="mono">{decision.adapter_id}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Requested at</span>
              <span>{decision.created_at ? new Date(decision.created_at).toLocaleString() : "—"}</span>
            </div>
          </div>

          <div class="drawer-section-header">Intent & Context</div>
          <div class="detail-block">
            <div style={{ fontSize: "13px", lineHeight: "1.5", marginBottom: "12px", color: "var(--text-primary)" }}>
              {intentText || "No intent description provided by adapter."}
            </div>
            {r.context && (
              <pre class="mono text-secondary" style={{ fontSize: "11px", whiteSpace: "pre-wrap" }}>
                {JSON.stringify(r.context, null, 2)}
              </pre>
            )}
          </div>

          <div class="drawer-section-header">Policy Evaluation</div>
          <div class="detail-block">
            <div class="detail-row">
              <span class="detail-label">Matched Policies</span>
              <div style={{ textAlign: "right" }}>
                {(pol.matched_policies || []).map(p => (
                  <div key={p} class="mono text-xs">{p}</div>
                ))}
                {!(pol.matched_policies || []).length && <span class="text-secondary">—</span>}
              </div>
            </div>
            {pol.blocked_reason && (
              <div class="detail-row">
                <span class="detail-label">Reason</span>
                <span class="text-danger">{pol.blocked_reason}</span>
              </div>
            )}
            {pol.explanation && (
              <div style={{ marginTop: "12px", padding: "8px", background: "var(--bg-subtle)", borderRadius: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>
                {pol.explanation}
              </div>
            )}
          </div>

          <div class="drawer-section-header">Raw Request</div>
          <details>
            <summary style={{ cursor: "pointer", fontSize: "12px", color: "var(--text-secondary)" }}>Show full JSON</summary>
            <pre class="mono" style={{ fontSize: "11px", marginTop: "8px", overflow: "auto" }}>
              {JSON.stringify(r, null, 2)}
            </pre>
          </details>

          {/* Action Footer (Sticky at bottom of drawer body, or just inline) */}
          <div style={{ marginTop: "32px", paddingTop: "16px", borderTop: "1px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", gap: "12px" }}>
              <button 
                class="btn-primary w-full" 
                style={{ justifyContent: "center" }}
                onClick={() => setConfirm("approve")}
                disabled={busy}
              >
                Approve Request
              </button>
              <button 
                class="btn-secondary w-full" 
                style={{ justifyContent: "center" }}
                onClick={() => setConfirm("deny")}
                disabled={busy}
              >
                Deny
              </button>
            </div>
            <p class="text-secondary text-xs" style={{ textAlign: "center", marginTop: "12px" }}>
              Approvals are self-attested (local/OSS).
            </p>
          </div>

        </div>
      </div>
      
      <div 
        class="drawer-backdrop" 
        onClick={onClose}
        style={decision ? { opacity: 1, pointerEvents: "auto" } : {}} 
      />

      {/* Confirmation Modal */}
      {confirm && (
        <div class="modal" onClick={(e) => e.stopPropagation()}>
          <div class="modal-backdrop" onClick={() => !busy && setConfirm(null)} />
          <div class="modal-dialog">
            <div class="modal-header">
              <h3>Confirm {confirm === "approve" ? "Approval" : "Denial"}</h3>
              <button class="btn-ghost btn-sm" disabled={busy} onClick={() => setConfirm(null)}><XIcon /></button>
            </div>
            <div class="modal-body">
              <p class="text-secondary" style={{ lineHeight: "1.5" }}>
                You are about to <strong>{confirm}</strong> this request.
                This action is recorded in the local audit log.
              </p>
              <div style={{ marginTop: "16px", padding: "12px", background: "var(--bg-subtle)", borderRadius: "6px" }}>
                <div class="detail-row">
                  <span class="detail-label">Tool</span>
                  <span class="mono">{r.tool}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Target</span>
                  <span class="mono">{(r.context?.targets || [])[0] || "—"}</span>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-ghost" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
              <button 
                class={confirm === "approve" ? "btn-primary" : "btn-danger"} 
                disabled={busy}
                onClick={() => resolve(confirm === "approve" ? "approved" : "denied")}
              >
                {busy ? "Working..." : `Confirm ${confirm === "approve" ? "Approve" : "Deny"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
