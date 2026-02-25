import { useEffect, useState } from "preact/hooks";
import {
  tenantId,
  selectedWorkspace,
  showToast,
  pendingApprovalsCount,
  hasPermission,
  policyDraftPanel,
  policyExceptionResolution,
} from "../state.js";
import { api, apiPost, buildParams, refreshPendingApprovalsCount } from "../api.js";
import { XIcon, ShieldIcon, RefreshIcon } from "../components/icons.jsx";
import { GovernanceBadge } from "../components/badge.jsx";

const PENDING_DECISIONS_TOOLTIP =
  "Pending decisions represent execution requests paused by governance policies that require human input. Clasper Core supports local approvals for single-operator workflows. These approvals are self-attested and not externally verifiable.";

const RECENTLY_APPROVED_TOOLTIP =
  "Recently approved decisions show executions that were approved locally, including auto-resolutions from matching exception rules. Clasper Core supports local approvals for single-operator workflows. These approvals are self-attested and not externally verifiable.";

function getTargetPaths(context) {
  const targets = context?.targets;
  if (Array.isArray(targets)) return targets;
  if (targets && Array.isArray(targets.paths)) return targets.paths;
  return [];
}

function formatConditionDetail(detail) {
  if (!detail) return null;
  if (detail.field === "context.exec.argv0" && detail.result && detail.operator === "in") {
    return `Allowed: argv0 matched allowlist (${String(detail.actual)})`;
  }
  if (
    detail.field === "context.targets.paths" &&
    !detail.result &&
    (detail.operator === "all_under" || detail.operator === "any_under")
  ) {
    const firstPath = Array.isArray(detail.actual) ? detail.actual[0] : null;
    return firstPath
      ? `Blocked: path \`${firstPath}\` outside allowed scope`
      : "Blocked: path outside allowed scope";
  }
  if (!detail.result) {
    return `Condition failed: ${detail.field} (${detail.operator})`;
  }
  return `Matched condition: ${detail.field} (${detail.operator})`;
}

function getApprovalSource(decision) {
  const resolution = decision?.resolution || {};
  const justification = typeof resolution?.justification === "string" ? resolution.justification : "";
  if (justification === "policy_exception_created" || justification === "policy_exception_refresh_scan") {
    return "exception_rule_auto";
  }
  return "manual_or_unknown";
}

export function ApprovalsView() {
  const [decisions, setDecisions] = useState(null);
  const [selectedDecision, setSelectedDecision] = useState(null);
  const [activeTab, setActiveTab] = useState("pending");
  const resolutionEvent = policyExceptionResolution.value;

  const load = async ({ reconcile = false } = {}) => {
    try {
      if (reconcile && activeTab === "pending") {
        try {
          const payload = {};
          if (selectedWorkspace.value) payload.workspace_id = selectedWorkspace.value;
          const reconcileResult = await apiPost("/ops/api/decisions/reconcile", payload);
          if ((reconcileResult?.resolved_count || 0) > 0) {
            showToast(`Auto-resolved ${reconcileResult.resolved_count} pending request(s)`, "success");
          }
        } catch {
          showToast("Could not run auto-resolution scan; queue was refreshed", "warn");
        }
      }
      const data = await api(
        `/ops/api/decisions?${buildParams({
          status: activeTab === "pending" ? "pending" : "approved",
          limit: activeTab === "pending" ? 100 : 50,
        })}`
      );
      const records = data.decisions || [];
      setDecisions(records);
      if (activeTab === "pending") {
        pendingApprovalsCount.value = records.length;
      }
    } catch {
      setDecisions([]);
      if (activeTab === "pending") {
        pendingApprovalsCount.value = 0;
      }
    }
  };

  useEffect(() => { load(); }, [tenantId.value, selectedWorkspace.value, activeTab]);

  useEffect(() => {
    const decisionIds = Array.isArray(resolutionEvent?.decisionIds) ? resolutionEvent.decisionIds : [];
    if (!resolutionEvent?.updatedAt || decisionIds.length === 0) return;
    setDecisions((prev) =>
      Array.isArray(prev) ? prev.filter((decision) => !decisionIds.includes(decision.decision_id)) : prev
    );
    setSelectedDecision((prev) =>
      prev?.decision_id && decisionIds.includes(prev.decision_id) ? null : prev
    );
    refreshPendingApprovalsCount();
  }, [resolutionEvent?.updatedAt]);

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
            <h3 data-tooltip={activeTab === "pending" ? PENDING_DECISIONS_TOOLTIP : RECENTLY_APPROVED_TOOLTIP}>
              {activeTab === "pending" ? "Pending Decisions" : "Recently Approved"}
            </h3>
          </div>
          <button class="btn-secondary btn-sm" onClick={() => load({ reconcile: true })}>
            <RefreshIcon width={14} /> {activeTab === "pending" ? "Refresh Queue" : "Refresh"}
          </button>
        </div>
        <div style={{ display: "flex", gap: "8px", padding: "10px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
          <button
            class={activeTab === "pending" ? "btn-secondary btn-sm" : "btn-ghost btn-sm"}
            onClick={() => setActiveTab("pending")}
            type="button"
          >
            Pending
          </button>
          <button
            class={activeTab === "approved" ? "btn-secondary btn-sm" : "btn-ghost btn-sm"}
            onClick={() => setActiveTab("approved")}
            type="button"
          >
            Recently Approved
          </button>
        </div>

        <div class="panel-list">
          {decisions === null && <div class="empty-state"><div class="spinner" /></div>}
          {decisions && !decisions.length && (
            <div class="empty-state">
              <div class="empty-icon">✓</div>
              <div>{activeTab === "pending" ? "No pending approvals" : "No recently approved decisions"}</div>
            </div>
          )}
          {decisions && decisions.length > 0 && (
            <div class="list-group">
              {decisions.map((d) => (
                <DecisionRow
                  key={d.decision_id}
                  decision={d}
                  mode={activeTab}
                  onClick={() => openDrawer(d)}
                />
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

function DecisionRow({ decision, mode, onClick }) {
  const req = decision.request_snapshot || {};
  const r = req.request || {};
  const approvalSource = getApprovalSource(decision);
  
  const tool = r.tool || (Array.isArray(r.requested_capabilities) ? r.requested_capabilities[0] : "unknown");
  const target = getTargetPaths(r.context)[0];
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
          {mode === "pending" ? (
            <GovernanceBadge decision="pending_approval" />
          ) : (
            <span class="badge-pill success">Approved</span>
          )}
          {mode === "approved" && approvalSource === "exception_rule_auto" && (
            <span class="badge-pill info" data-tooltip="This request was auto-approved because it matched an exception rule.">
              Auto-approved by exception
            </span>
          )}
          <strong style={{ fontSize: "14px", color: "var(--text-primary)" }}>
            {tool} {target ? <span class="text-secondary" style={{ fontWeight: 400 }}>on {target}</span> : ""}
          </strong>
        </div>
        <div class="text-secondary text-xs" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {decision.adapter_id}
          {intent && intent !== "unknown" ? ` · ${intent}` : " · Intent not specified"}
          {mode === "approved" && approvalSource === "exception_rule_auto" ? " · Exception rule matched" : ""}
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
  const resolution = decision.resolution || {};
  const resolvedMatchedPolicies = Array.isArray(resolution.matched_policy_ids)
    ? resolution.matched_policy_ids.filter((id) => typeof id === "string")
    : [];
  const resolvedDecisionTrace = Array.isArray(resolution.policy_decision_trace)
    ? resolution.policy_decision_trace
    : [];
  const resolvedPolicyExplanation =
    typeof resolution.policy_explanation === "string" ? resolution.policy_explanation : "";
  const resolutionReason =
    typeof resolution.justification === "string" ? resolution.justification : "";
  const intentText = r.intent && r.intent !== "unknown" ? r.intent : null;
  const canManagePolicy = hasPermission("policy:manage");
  const isPending = decision.status === "pending";
  const approvalSource = getApprovalSource(decision);

  const openExceptionWizard = () => {
    const toolName =
      r.tool || (Array.isArray(r.requested_capabilities) ? r.requested_capabilities[0] : "unknown");
    policyDraftPanel.value = {
      open: true,
      trace: {
        id: decision.decision_id || `approval-${Date.now()}`,
        tenant_id: r.tenant_id || tenantId.value || "local",
        workspace_id: r.workspace_id || selectedWorkspace.value || undefined,
        tool_group: r.tool_group || undefined,
        tool_names: toolName ? [toolName] : [],
        context: r.context || {},
        adapter_id: decision.adapter_id || undefined,
        request_snapshot: decision.request_snapshot || undefined,
      },
    };
  };
  
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
              <span class="detail-label">Adapter</span>
              <span class="mono">{decision.adapter_id}</span>
            </div>
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
              <span class="mono">{getTargetPaths(r.context).join(", ") || "—"}</span>
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
            {!isPending && decision.status === "approved" && (
              <div
                style={{
                  marginBottom: "10px",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  background:
                    approvalSource === "exception_rule_auto"
                      ? "rgba(var(--accent-primary-rgb), 0.12)"
                      : "var(--bg-subtle)",
                  border:
                    approvalSource === "exception_rule_auto"
                      ? "1px solid var(--accent-primary)"
                      : "1px solid var(--border-subtle)",
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                }}
              >
                {approvalSource === "exception_rule_auto"
                  ? "Auto-approved by matching exception rule."
                  : "Approved locally by operator action."}
              </div>
            )}
            {!isPending && decision.status === "approved" && (
              <>
                <div class="detail-row">
                  <span class="detail-label">Resolution Source</span>
                  <span class="mono">
                    {resolutionReason === "policy_exception_created"
                      ? "Exception rule created from approval"
                      : resolutionReason === "policy_exception_refresh_scan"
                        ? "Exception rule refresh scan"
                        : "Manual/local approval"}
                  </span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Resolved at</span>
                  <span>{resolution?.resolved_at ? new Date(resolution.resolved_at).toLocaleString() : "—"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Approved by</span>
                  <span class="mono">{resolution?.approved_by || "—"}</span>
                </div>
              </>
            )}
            <div class="detail-row">
              <span class="detail-label">Matched Policies</span>
              <div style={{ textAlign: "right" }}>
                {(resolvedMatchedPolicies.length > 0 ? resolvedMatchedPolicies : (pol.matched_policies || [])).map(p => (
                  <div key={p} class="mono text-xs">{p}</div>
                ))}
                {(resolvedMatchedPolicies.length === 0 && !(pol.matched_policies || []).length) && <span class="text-secondary">—</span>}
              </div>
            </div>
            {pol.blocked_reason && (
              <div class="detail-row">
                <span class="detail-label">Reason</span>
                <span class="text-danger">{pol.blocked_reason}</span>
              </div>
            )}
            {(resolvedPolicyExplanation || pol.explanation) && (
              <div style={{ marginTop: "12px", padding: "8px", background: "var(--bg-subtle)", borderRadius: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>
                {resolvedPolicyExplanation || pol.explanation}
              </div>
            )}
            {((resolvedDecisionTrace.length > 0) || (Array.isArray(pol.decision_trace) && pol.decision_trace.length > 0)) && (
              <div style={{ marginTop: "12px", display: "grid", gap: "6px" }}>
                {(resolvedDecisionTrace.length > 0 ? resolvedDecisionTrace : pol.decision_trace)
                  .flatMap((entry) => (Array.isArray(entry.condition_details) ? entry.condition_details : []))
                  .slice(0, 4)
                  .map((detail, idx) => (
                    <div key={`cond-${idx}`} class="text-secondary text-xs">
                      {formatConditionDetail(detail)}
                    </div>
                  ))}
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
            {isPending ? (
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
            ) : (
              <div class="text-secondary text-xs" style={{ textAlign: "center", marginBottom: "8px" }}>
                This decision is already {decision.status}.
              </div>
            )}
            {canManagePolicy && isPending && (
              <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px dashed var(--border-subtle)" }}>
                <button
                  class="btn-secondary w-full"
                  style={{ justifyContent: "center", gap: "8px" }}
                  onClick={openExceptionWizard}
                  disabled={busy}
                >
                  <ShieldIcon width={14} />
                  Create Exception Rule
                </button>
                <div class="text-secondary text-xs" style={{ marginTop: "6px", textAlign: "center" }}>
                  Permanently allow similar requests in future
                </div>
                <button
                  class="btn-ghost w-full"
                  style={{ justifyContent: "center", marginTop: "8px" }}
                  onClick={() => {
                    location.hash = "#policies";
                    onClose();
                  }}
                  disabled={busy}
                >
                  Manage Exception Rules
                </button>
              </div>
            )}
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
                  <span class="mono">{getTargetPaths(r.context)[0] || "—"}</span>
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
