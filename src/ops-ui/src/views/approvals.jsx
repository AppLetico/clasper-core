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
import { copy, formatTimestamp } from "../copy.js";
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

/** Tool-specific label and value for the approval modal (Channel, URL, Query, or Target). */
function getTargetLabelAndValue(tool, context) {
  const toolName = (tool || "").toLowerCase();
  const targets = context?.targets;
  if (toolName === "message") {
    const channel =
      (typeof context?.channel_display === "string" ? context.channel_display : null) ||
      (typeof context?.channel === "string" ? context.channel : null) ||
      (typeof context?.recipient === "string" ? context.recipient : null) ||
      (Array.isArray(targets?.hosts) ? targets.hosts[0] : null) ||
      (typeof context?.to === "string" ? context.to : null);
    return {
      label: "Channel",
      value: channel || "—",
      title: "Destination channel (e.g. whatsapp: +1234567890). Blank when not provided by adapter.",
    };
  }
  // Channel gateway tools (whatsapp_login, slack, discord, etc.)
  const channelGatewayTools = ["whatsapp_login", "slack", "discord", "telegram_login", "msteams_login"];
  if (channelGatewayTools.includes(toolName) || toolName.endsWith("_login")) {
    const channel =
      (typeof context?.channel_display === "string" ? context.channel_display : null) ||
      (typeof context?.channel === "string" ? context.channel : null);
    const display =
      channel ||
      (toolName.endsWith("_login")
        ? toolName.replace(/_login$/, "").replace(/^./, (c) => c.toUpperCase())
        : toolName.charAt(0).toUpperCase() + toolName.slice(1));
    return {
      label: "Channel",
      value: display || "—",
      title: "Messaging platform this login/gateway tool operates on.",
    };
  }
  if (toolName === "web_fetch" || toolName === "http_request" || toolName === "fetch") {
    const url = typeof context?.url === "string" ? context.url : null;
    return {
      label: "URL",
      value: url || (Array.isArray(targets?.hosts) ? targets.hosts[0] : null) || "—",
      title: "URL being fetched. Blank when not provided by adapter.",
    };
  }
  if (toolName === "web_search") {
    const query = typeof context?.query === "string" ? context.query : null;
    return {
      label: "Query",
      value: query || "—",
      title: "Search query. Blank when not provided by adapter.",
    };
  }
  if (toolName === "browser") {
    const url = typeof context?.url === "string" ? context.url : null;
    const host = Array.isArray(targets?.hosts) ? targets.hosts.find((h) => !h.startsWith("node:") && !h.startsWith("session:")) : null;
    return {
      label: "URL",
      value: url || host || "—",
      title: "URL being navigated or page target.",
    };
  }
  if (toolName === "nodes") {
    const node = Array.isArray(targets?.hosts)
      ? targets.hosts.find((h) => h.startsWith("node:"))?.replace(/^node:/, "")
      : null;
    const cmd = context?.exec?.argv?.join?.(" ");
    return {
      label: "Node",
      value: node || "—",
      title: cmd ? `Node: ${node || "default"}; command: ${cmd}` : "Target node for run/notify/camera.",
    };
  }
  if (toolName === "process") {
    const sessionId = Array.isArray(targets?.hosts)
      ? targets.hosts.find((h) => h.startsWith("session:"))?.replace(/^session:/, "")
      : null;
    return {
      label: "Session",
      value: sessionId || "—",
      title: "Background exec session being polled/written/killed.",
    };
  }
  if (
    toolName === "sessions_send" ||
    toolName === "sessions_spawn" ||
    toolName === "session_status" ||
    toolName === "sessions_history"
  ) {
    const sessionKey = Array.isArray(targets?.hosts)
      ? targets.hosts.find((h) => h.startsWith("session:"))?.replace(/^session:/, "")
      : null;
    return {
      label: "Session",
      value: sessionKey || "—",
      title: "Target session for send/spawn/status/history.",
    };
  }
  if (toolName === "image" || toolName === "pdf") {
    const path = getTargetPaths(context)[0];
    const url = typeof context?.url === "string" ? context.url : null;
    return {
      label: toolName === "image" ? "Image" : "PDF",
      value: url || path || "—",
      title: "Path or URL of document to analyze.",
    };
  }
  const path = getTargetPaths(context)[0];
  const host = Array.isArray(targets?.hosts) ? targets.hosts[0] : null;
  return {
    label: "Target",
    value: path || host || "—",
    title: "File paths or resources the tool operates on.",
  };
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
    <section class="approvals-view">
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

        <div class={activeTab === "approved" ? "table-container" : "panel-list"}>
          {decisions === null && <div class="empty-state"><div class="spinner" /></div>}
          {decisions && !decisions.length && (
            <div class="empty-state">
              <div class="empty-icon">✓</div>
              <div>{activeTab === "pending" ? "No pending approvals" : "No recently approved decisions"}</div>
            </div>
          )}
          {decisions && decisions.length > 0 && activeTab === "pending" && (
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
          {decisions && decisions.length > 0 && activeTab === "approved" && (
            <table class="data-table">
              <thead>
                <tr>
                  <th data-tooltip={copy.tooltips.traces.traceId}>Decision ID</th>
                  <th data-tooltip={copy.tooltips.traces.timestamp}>Timestamp</th>
                  <th data-tooltip={copy.tooltips.traces.outcome}>Status</th>
                  <th data-tooltip={copy.tooltips.traces.governance}>Governance</th>
                  <th data-tooltip={copy.tooltips.traces.role}>Adapter</th>
                  <th data-tooltip="Agent ID from the execution request">Agent</th>
                  <th data-tooltip={copy.tooltips.traces.requested}>Tool</th>
                  <th data-tooltip={copy.tooltips.traces.policyScope}>Policy & Scope</th>
                  <th data-tooltip="Intent from the request">Intent</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => (
                  <DecisionTableRow
                    key={d.decision_id}
                    decision={d}
                    mode={activeTab}
                    onClick={() => openDrawer(d)}
                  />
                ))}
              </tbody>
            </table>
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
          {r.agent_id ? ` · ${r.agent_id}` : ""}
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

function DecisionTableRow({ decision, mode, onClick }) {
  const req = decision.request_snapshot || {};
  const r = req.request || {};
  const pol = req.decision || {};
  const approvalSource = getApprovalSource(decision);

  const tool = r.tool || (Array.isArray(r.requested_capabilities) ? r.requested_capabilities[0] : "unknown");
  const matchedPolicies = pol.matched_policies || [];
  const policyDisplay = matchedPolicies.slice(0, 2).join(", ") + (matchedPolicies.length > 2 ? "…" : "");
  const intent = r.intent && r.intent !== "unknown" ? r.intent : "—";

  return (
    <tr onClick={onClick} style={{ cursor: "pointer" }}>
      <td class="mono" title={decision.decision_id}>{decision.decision_id?.slice(0, 8)}…</td>
      <td class="text-secondary" title={decision.created_at}>
        {formatTimestamp(decision.created_at)}
      </td>
      <td>
        {mode === "pending" ? (
          <span class="badge-pill warn">Pending</span>
        ) : (
          <span class="badge-pill success">Approved</span>
        )}
        {mode === "approved" && approvalSource === "exception_rule_auto" && (
          <span class="badge-pill info" style={{ marginLeft: "6px" }} data-tooltip="Auto-approved by exception rule">
            Auto
          </span>
        )}
      </td>
      <td>
        {mode === "pending" ? (
          <GovernanceBadge decision="pending_approval" />
        ) : (
          <GovernanceBadge decision="allow" />
        )}
      </td>
      <td>{decision.adapter_id || "—"}</td>
      <td class="mono text-secondary" style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis" }} title={r.agent_id || "—"}>
        {r.agent_id || "—"}
      </td>
      <td class="mono" style={{ maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis" }} title={tool}>
        {tool || "—"}
      </td>
      <td class="col-policy-scope">
        <div class="text-secondary" style={{ fontSize: "12px" }} title={matchedPolicies.join(", ")}>
          {policyDisplay || "—"}
        </div>
      </td>
      <td class="text-secondary" style={{ maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis" }} title={intent}>
        {intent}
      </td>
    </tr>
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
            {(r.agent_id || r.agent_role) && (
              <div class="detail-row">
                <span class="detail-label">Agent</span>
                <span class="mono">{[r.agent_id, r.agent_role].filter(Boolean).join(" · ") || "—"}</span>
              </div>
            )}
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
            {(() => {
              const { label, value, title } = getTargetLabelAndValue(r.tool, r.context);
              const toolName = (r.tool || "").toLowerCase();
              const useToolSpecific =
                ["message", "web_fetch", "http_request", "fetch", "web_search"].includes(toolName);
              const displayValue = useToolSpecific
                ? value
                : getTargetPaths(r.context).join(", ") || "—";
              return (
                <div class="detail-row">
                  <span class="detail-label" title={title}>{label}</span>
                  <span class="mono">{displayValue}</span>
                </div>
              );
            })()}
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
            {(pol.risk_score != null || pol.risk_level) && (
              <div class="detail-row">
                <span class="detail-label" title="Risk score 0–100 from governance evaluation">Risk</span>
                <span class="mono">{pol.risk_score != null ? `${pol.risk_score}/100` : "—"} ({pol.risk_level ?? "—"})</span>
              </div>
            )}
            {!!pol.policy_bundle_hash && (
              <div class="detail-row">
                <span class="detail-label" title="SHA-256 hash of policy bundle at evaluation time">Policy bundle hash</span>
                <span class="mono" style={{ fontSize: "11px", wordBreak: "break-all" }}>{pol.policy_bundle_hash}</span>
              </div>
            )}
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
                  <span class="detail-label">Agent</span>
                  <span class="mono">{decision.adapter_id || "—"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Tool</span>
                  <span class="mono">{r.tool}</span>
                </div>
                {(() => {
                  const { label, value, title } = getTargetLabelAndValue(r.tool, r.context);
                  return (
                    <div class="detail-row">
                      <span class="detail-label" title={title}>{label}</span>
                      <span class="mono">{value}</span>
                    </div>
                  );
                })()}
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
