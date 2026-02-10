import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { XIcon } from "./icons.jsx";
import { ExecutionBadge, GovernanceBadge } from "./badge.jsx";
import { formatCost, tenantId } from "../state.js";
import { TRUST_LABEL, titleCase } from "../labelColors.js";
import { api, buildParams } from "../api.js";

export const drawerOpen = signal(false);
export const drawerTraceId = signal(null);

export function TraceDrawer() {
  const open = drawerOpen.value;
  const traceId = drawerTraceId.value;
  const [trace, setTrace] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!traceId || !open) return;
    setLoading(true);
    setTrace(null);
    api(`/ops/api/traces/${traceId}?tenant_id=${tenantId.value}`)
      .then((d) => setTrace(d.trace))
      .catch(() => setTrace(null))
      .finally(() => setLoading(false));
  }, [traceId, open]);

  const close = () => { drawerOpen.value = false; };

  return (
    <>
      <div class={`drawer ${open ? "open" : ""}`}>
        <div class="drawer-header">
          <h3>Trace Detail</h3>
          <div class="drawer-actions">
            <button class="btn-icon" onClick={close}><XIcon /></button>
          </div>
        </div>
        <div class="drawer-body">
          {loading && <div class="empty-state"><div class="spinner" /></div>}
          {!loading && !trace && <div class="empty-state">Failed to load detail</div>}
          {!loading && trace && <TraceDetailContent trace={trace} />}
        </div>
      </div>
      <div class={`drawer-backdrop ${open ? "" : ""}`} onClick={close} style={open ? { opacity: 1, pointerEvents: "auto" } : {}} />
    </>
  );
}

function TraceDetailContent({ trace }) {
  const json = (v) => {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  };

  const stepTitle = (s) => {
    const d = s?.data || {};
    if (s.type === "tool_call") return `${d.toolName || "tool"} · ${d.permitted ? "permitted" : "denied"}`;
    if (s.type === "tool_result") return `${d.toolName || "tool"} · ${d.success ? "success" : "error"}`;
    if (s.type === "llm_call") return `${d.provider || "provider"}/${d.model || "model"} · in ${d.inputTokens ?? "?"} · out ${d.outputTokens ?? "?"}`;
    if (s.type === "error") return `${d.code || "error"}`;
    return s.type;
  };

  const gov = trace.governance || {};
  const scopeDelta = gov.scope_delta || {};
  const deniedTools = gov.denied_tools || [];
  const policyIds = gov.policy_ids || [];
  const requested = trace.requested_capabilities || trace.granted_scope?.capabilities || [];

  return (
    <>
      <div class="detail-block">
        <div class="detail-row"><span class="detail-label">Trace ID</span><span class="mono">{trace.id}</span></div>
        <div class="detail-row">
            <span class="detail-label">Governance decision</span>
            <GovernanceBadge decision={gov.decision || "unknown"} />
        </div>
        <div class="detail-row"><span class="detail-label">Execution outcome</span><ExecutionBadge status={trace.status} /></div>
        <div class="detail-row"><span class="detail-label">Agent</span><span class="mono">{trace.agent_role || "-"}</span></div>
        <div class="detail-row"><span class="detail-label">Adapter</span><span class="mono">{trace.adapter_id || "-"}</span></div>
        <div class="detail-row"><span class="detail-label">Cost</span><span>{formatCost(trace.cost)}</span></div>
        <div class="detail-row"><span class="detail-label">Environment</span><span>{trace.environment}</span></div>
        <div class="detail-row">
            <span class="detail-label" title="Verification status of the trace source">Trust</span>
            <span class="mono" title="Local/self-attested; verification may be unavailable in OSS mode">
                {trace.trust_status ? (TRUST_LABEL[trace.trust_status] ?? titleCase(trace.trust_status)) : "-"} (local)
            </span>
        </div>
        <div class="detail-row">
            <span class="detail-label" title="Cryptographic integrity of the trace">Integrity</span>
            <span class="mono" title="Unsigned traces are expected for local adapters">
                {trace.integrity?.status || "-"} (self-attested)
            </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Requested</span>
          <span class="mono">{requested.join(", ") || "-"}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Tools</span>
          <span class="mono">{(trace.tool_names || []).join(", ") || "-"}</span>
        </div>
      </div>

      <div class="drawer-section-header">Decision timeline</div>
      <div class="detail-block">
        <div class="detail-row">
          <span class="detail-label">Execution</span>
          <span class="mono">{gov.execution_id || trace.labels?.execution_id || "-"}</span>
        </div>
        <div class="detail-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: "6px" }}>
          <span class="detail-label">Decision</span>
          <div class="mono" style={{ 
            background: "var(--bg-panel)", 
            padding: "8px 12px", 
            borderRadius: "6px", 
            width: "100%", 
            whiteSpace: "pre-wrap",
            border: "1px solid var(--border-panel)",
            fontSize: "12px",
            lineHeight: "1.5",
            color: "var(--text-primary)"
          }}>
            {gov.decision_summary || "-"}
          </div>
        </div>
        <div class="detail-row">
          <span class="detail-label">Decision ID</span>
          <span class="mono">{gov.decision_id || "-"}</span>
        </div>
        {!!gov.required_role && (
          <div class="detail-row">
            <span class="detail-label">Required role</span>
            <span class="mono">{gov.required_role}</span>
          </div>
        )}
        {!!gov.expires_at && (
          <div class="detail-row">
            <span class="detail-label">Expires</span>
            <span class="mono">{gov.expires_at}</span>
          </div>
        )}
        <div class="detail-row">
          <span class="detail-label">Tool auth</span>
          <div style={{ display: "flex", gap: "6px" }}>
            <span class="badge-pill success">
              {(trace.tool_count ?? 0) - (deniedTools.length || 0)} allow
            </span>
            <span class={`badge-pill ${deniedTools.length > 0 ? "danger" : ""}`}>
              {deniedTools.length} deny
            </span>
          </div>
        </div>
      </div>

      {!!(policyIds || []).length && (
        <>
          <div class="drawer-section-header">Policy matches</div>
          <div class="detail-block">
            <div class="detail-row">
              <span class="detail-label">Policy IDs</span>
              <span class="mono">{policyIds.join(", ")}</span>
            </div>
            {!!deniedTools.length && (
              <div style={{ marginTop: "10px" }}>
                <div class="text-secondary" style={{ fontSize: "12px", marginBottom: "6px" }}>Denied tools</div>
                {deniedTools.map((d, i) => (
                  <div key={i} class="detail-row">
                    <span class="mono">{d.tool}</span>
                    <span class="text-secondary" style={{ fontSize: "12px" }}>
                      {d.policy_id ? `policy: ${d.policy_id}` : "policy"}{d.reason ? ` · ${d.reason}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div class="drawer-section-header">Scope: granted vs used</div>
      <div class="detail-block">
        <div class="detail-row">
          <span class="detail-label">Granted</span>
          <span class="mono">
            steps {trace.granted_scope?.max_steps ?? "—"} · cost {trace.granted_scope?.max_cost ?? "—"}
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Used</span>
          <span class="mono">
            steps {trace.used_scope?.step_count ?? "—"} · cost {trace.used_scope?.actual_cost != null ? Number(trace.used_scope.actual_cost).toFixed(4) : "—"}
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Within scope</span>
          <span class="mono">{scopeDelta.within_scope == null ? "—" : (scopeDelta.within_scope ? "yes" : "no")}</span>
        </div>
      </div>

      <div class="drawer-section-header">Why high risk?</div>
      <div class="detail-block">
        <div class="detail-row"><span class="detail-label">Risk</span><span>{trace.risk?.score} ({trace.risk?.level})</span></div>
        {!!(trace.risk?.factors || []).length ? (
          <pre class="text-secondary" style={{ marginTop: "10px", whiteSpace: "pre-wrap", fontSize: "12px" }}>{(trace.risk.factors || []).join("\n")}</pre>
        ) : (
          <div class="text-secondary" style={{ fontSize: "12px" }}>—</div>
        )}
      </div>

      <div class="drawer-section-header">Input</div>
      <div class="detail-block">
        <div class="detail-row"><span class="detail-label">Message history</span><span class="mono">{trace.input?.message_history ?? "-"}</span></div>
        <pre class="mono" style={{ marginTop: "10px", whiteSpace: "pre-wrap" }}>{trace.input?.message || "-"}</pre>
      </div>

      {trace.output && (
        <>
          <div class="drawer-section-header">Output</div>
          <div class="detail-block">
            <pre class="mono" style={{ whiteSpace: "pre-wrap" }}>{trace.output?.message || "-"}</pre>
            {!!(trace.output?.tool_calls || []).length && (
              <div style={{ marginTop: "10px" }}>
                <div class="text-secondary" style={{ fontSize: "12px", marginBottom: "6px" }}>Tool calls</div>
                {(trace.output.tool_calls || []).map((tc) => (
                  <div key={tc.id} class="detail-row">
                    <span class="mono">{tc.name}</span>
                    <span class="text-secondary" style={{ fontSize: "12px" }}>{tc.permitted ? "permitted" : "denied"} · {tc.success ? "success" : "error"} · {tc.duration_ms}ms</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div class="drawer-section-header">
        Execution Steps ({(trace.steps || []).length})
      </div>
      <details>
        <summary style={{ cursor: "pointer", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "8px" }}>
            Show {(trace.steps || []).length} steps
        </summary>
        <div class="steps">
            {(trace.steps || []).map((s, i) => (
            <div key={i} class="step">
                <div class="detail-row">
                <strong>{stepTitle(s)}</strong>
                <span class="mono text-secondary">{s.duration_ms}ms</span>
                </div>
                <div class="text-secondary" style={{ fontSize: "12px" }}>{s.timestamp}</div>
                <details style={{ marginTop: "6px" }}>
                <summary class="text-secondary" style={{ fontSize: "12px", cursor: "pointer" }}>View step data</summary>
                <pre class="mono" style={{ marginTop: "8px", whiteSpace: "pre-wrap" }}>{json(s.data)}</pre>
                </details>
            </div>
            ))}
        </div>
      </details>
    </>
  );
}

export function openTrace(id) {
  drawerTraceId.value = id;
  drawerOpen.value = true;
}
