import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { XIcon, CopyIcon } from "./icons.jsx";
import { ExecutionBadge, GovernanceBadge, RiskBadge } from "./badge.jsx";
import { formatCost, tenantId, selectedWorkspace, policyDraftPanel, hasPermission, showToast, authHeaders } from "../state.js";
import { TRUST_LABEL, titleCase, riskScoreToLevel } from "../labelColors.js";
import { api, apiPost, buildParams } from "../api.js";

async function copyToClipboard(text) {
  if (globalThis?.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "absolute";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

function isFallbackOnlyTrace(trace) {
  const gov = trace.governance || {};
  const isDeniedOrPending = ["deny", "pending_approval", "require_approval"].includes(gov.decision);
  const hasTools = (trace.tool_names || []).length > 0;
  return isDeniedOrPending && gov.policy_fallback_hit === true && hasTools;
}

export const drawerOpen = signal(false);
export const drawerTraceId = signal(null);

export function TraceDrawer() {
  const open = drawerOpen.value;
  const traceId = drawerTraceId.value;
  const [trace, setTrace] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

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
          <div class="drawer-actions" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {trace && (
              <>
                <button
                  type="button"
                  class="btn-secondary btn-sm"
                  title="Download trace and audit evidence bundle"
                  disabled={exporting}
                  onClick={async () => {
                    setExporting(true);
                    try {
                      const res = await fetch("/ops/api/exports", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", ...authHeaders.value },
                        body: JSON.stringify({
                          tenant_id: tenantId.value,
                          workspace_id: selectedWorkspace.value || undefined,
                          trace_id: trace.id
                        })
                      });
                      if (!res.ok) throw new Error(res.statusText);
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `clasper-evidence-${trace.id}.tar.gz`;
                      a.click();
                      URL.revokeObjectURL(url);
                      showToast("Evidence bundle downloaded", "success");
                    } catch (e) {
                      console.error("Export error:", e);
                      showToast("Export failed", "error");
                    } finally {
                      setExporting(false);
                    }
                  }}
                >
                  <CopyIcon style={{ width: "12px", height: "12px", marginRight: "4px", verticalAlign: "middle" }} />
                  {exporting ? "Exporting…" : "Export evidence"}
                </button>
                <button
                  type="button"
                  class="btn-secondary btn-sm"
                  title="Copy entire trace JSON to clipboard"
                  onClick={async () => {
                    try {
                      await copyToClipboard(JSON.stringify(trace, null, 2));
                      showToast("Trace copied to clipboard", "success");
                    } catch {
                      showToast("Copy failed", "warn");
                    }
                  }}
                >
                  <CopyIcon style={{ width: "12px", height: "12px", marginRight: "4px", verticalAlign: "middle" }} />
                  Copy trace
                </button>
              </>
            )}
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
  const [activeTab, setActiveTab] = useState("overview");
  const [simulateResult, setSimulateResult] = useState(null);
  const [simulateLoading, setSimulateLoading] = useState(false);
  const [replayResult, setReplayResult] = useState(null);
  const [replayLoading, setReplayLoading] = useState(false);

  const runSimulate = async () => {
    if (!trace?.id) return;
    setSimulateLoading(true);
    setSimulateResult(null);
    try {
      const params = buildParams();
      const res = await apiPost(`/ops/api/traces/${trace.id}/simulate?${params}`, {});
      setSimulateResult(res);
    } catch (e) {
      setSimulateResult({ error: e?.message || "Simulation failed" });
    } finally {
      setSimulateLoading(false);
    }
  };

  const runReplay = async () => {
    if (!trace?.id) return;
    setReplayLoading(true);
    setReplayResult(null);
    try {
      const params = buildParams();
      const res = await apiPost(`/ops/api/traces/${trace.id}/replay?${params}`, {});
      setReplayResult(res);
    } catch (e) {
      setReplayResult({ error: e?.message || "Replay failed" });
    } finally {
      setReplayLoading(false);
    }
  };

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

  const stepActionPreview = (s) => {
    if (s.type !== "tool_call") return null;
    const d = s?.data || {};
    const args = d.arguments || {};
    const tool = d.toolName || "";
    if (tool === "exec" || tool === "bash" || tool === "process") {
      const cmd = args.command ?? args.cmd ?? (Array.isArray(args.argv) ? args.argv.join(" ") : null);
      return cmd ? String(cmd) : null;
    }
    if (["read", "write", "edit", "delete", "apply_patch"].includes(tool)) {
      return args.path ?? args.file ?? args.target ?? null;
    }
    return null;
  };

  const gov = trace.governance || {};
  const scopeDelta = gov.scope_delta || {};
  const deniedTools = gov.denied_tools || [];
  const policyIds = gov.policy_ids || [];
  const requested = trace.requested_capabilities || trace.granted_scope?.capabilities || [];
  const displayAgent = trace.agent_role || (trace.adapter_id === "openclaw-local" ? "OpenClaw" : null) || "-";

  return (
    <>
      <div style={{ paddingBottom: "20px", borderBottom: "1px solid var(--border-subtle)", marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
          <div style={{ display: "flex", gap: "8px" }}>
            <GovernanceBadge decision={gov.decision || "unknown"} />
            <ExecutionBadge status={trace.status} />
            {(gov.risk_score != null || gov.risk_level || trace.risk?.score != null || trace.risk?.level) && (() => {
              const level = gov.risk_level || trace.risk?.level || riskScoreToLevel(gov.risk_score ?? trace.risk?.score);
              const score = gov.risk_score ?? trace.risk?.score;
              const tooltip = score != null ? `Score: ${score}/100` : undefined;
              return level ? <RiskBadge level={level} tooltip={tooltip} /> : null;
            })()}
          </div>
          {trace.started_at && (
             <span class="text-secondary text-xs mono">{new Date(trace.started_at).toLocaleString()}</span>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "16px" }}>
          <div>
            <div class="text-secondary text-xs" style={{ marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "11px" }}>Trace ID</div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span class="mono text-primary" style={{ fontSize: "12px", background: "var(--bg-subtle)", padding: "2px 6px", borderRadius: "4px" }}>{trace.id}</span>
              <button
                type="button"
                class="btn-icon"
                title="Copy Trace ID"
                style={{ width: "20px", height: "20px", padding: "0" }}
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await copyToClipboard(trace.id);
                    showToast("Trace ID copied", "success");
                  } catch {
                    showToast("Copy failed", "warn");
                  }
                }}
              >
                <CopyIcon style={{ width: "12px", height: "12px" }} />
              </button>
            </div>
          </div>
          <div>
            <div class="text-secondary text-xs" style={{ marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "11px" }}>Agent</div>
            <div class="text-primary" style={{ fontWeight: 500, fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={displayAgent}>{displayAgent}</div>
          </div>
          <div>
            <div class="text-secondary text-xs" style={{ marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "11px" }}>Cost</div>
            <div class="text-primary" style={{ fontSize: "13px" }}>{formatCost(trace.cost)}</div>
          </div>
          <div>
            <div class="text-secondary text-xs" style={{ marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "11px" }}>Duration</div>
            <div class="text-primary" style={{ fontSize: "13px" }}>{trace.duration_ms != null ? `${trace.duration_ms}ms` : "-"}</div>
          </div>
        </div>
      </div>

      <div class="theme-segments" style={{ marginBottom: "24px" }}>
        <button class={`theme-tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
        <button class={`theme-tab ${activeTab === 'governance' ? 'active' : ''}`} onClick={() => setActiveTab('governance')}>Governance</button>
        <button class={`theme-tab ${activeTab === 'execution' ? 'active' : ''}`} onClick={() => setActiveTab('execution')}>Execution</button>
        <button class={`theme-tab ${activeTab === 'json' ? 'active' : ''}`} onClick={() => setActiveTab('json')}>Raw JSON</button>
      </div>

      {activeTab === 'overview' && (
        <div class="tab-content animate-fade-in">
          {trace.status === "error" && (
            <div class="detail-block" style={{ borderLeft: "3px solid var(--accent-warn)", background: "var(--bg-subtle)", marginBottom: "20px" }}>
              <div class="drawer-section-header" style={{ marginTop: 0 }}>Execution Failed</div>
              <p class="text-secondary" style={{ fontSize: "13px", margin: "0 0 8px 0" }}>
                {gov.decision === "allow" || gov.decision === "approved"
                  ? "Policy allowed this run, but the tool failed during execution."
                  : "This run did not complete successfully."}
              </p>
              {trace.error && <pre class="mono" style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "12px", padding: "12px", background: "var(--bg-app)", borderRadius: "6px" }}>{trace.error}</pre>}
            </div>
          )}

          {(() => {
            const toolCallSteps = (trace.steps || []).filter((s) => s.type === "tool_call");
            const actionSummary = toolCallSteps.map((s) => {
              const d = s?.data || {};
              const args = d.arguments || {};
              const tool = d.toolName || "tool";
              if (tool === "exec" || tool === "bash" || tool === "process") {
                const cmd = args.command ?? args.cmd ?? (Array.isArray(args.argv) ? args.argv.join(" ") : null);
                return cmd ? { tool, summary: cmd } : { tool, summary: "(no command)" };
              }
              if (tool === "read" || tool === "write" || tool === "edit" || tool === "delete" || tool === "apply_patch") {
                const path = args.path ?? args.file ?? args.target;
                return path ? { tool, summary: String(path) } : { tool, summary: "(no path)" };
              }
              if (Object.keys(args).length > 0) {
                return { tool, summary: JSON.stringify(args, null, 2) };
              }
              return { tool, summary: null };
            });
            if (actionSummary.length > 0 && actionSummary.some((a) => a.summary)) {
              return (
                <div style={{ marginBottom: "24px" }}>
                  <div class="drawer-section-header" title="What the agent actually executed or accessed" style={{ marginTop: 0 }}>Activity</div>
                  <div class="detail-block">
                    {actionSummary.map((a, i) => (
                      <div key={i} class="detail-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: "8px", borderBottom: i < actionSummary.length - 1 ? "1px solid var(--border-subtle)" : "none", paddingBottom: i < actionSummary.length - 1 ? "12px" : "0", marginBottom: i < actionSummary.length - 1 ? "12px" : "0" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span class="badge-pill">{a.tool}</span>
                        </div>
                        <pre class="mono" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: "12px", background: "var(--bg-app)", padding: "12px", borderRadius: "6px", width: "100%", border: "1px solid var(--border-subtle)" }}>{a.summary}</pre>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
            return null;
          })()}

          <div style={{ marginBottom: "24px" }}>
              <div class="drawer-section-header" title="For chat traces: the user message. For tool traces: the tool or capability being invoked." style={{ marginTop: 0 }}>Input Context</div>
              <div class="detail-block">
                {trace.input?.message_history && (
                    <div class="detail-row"><span class="detail-label">Message history</span><span class="mono">{trace.input.message_history}</span></div>
                )}
                <pre class="mono" style={{ marginTop: "0", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "12px", color: "var(--text-secondary)" }}>{trace.input?.message || "-"}</pre>
              </div>
          </div>

          {trace.output && (
            <div style={{ marginBottom: "24px" }}>
              <div class="drawer-section-header">Execution Result</div>
              <div class="detail-block">
                <pre class="mono" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "12px", color: "var(--text-primary)" }}>{trace.output?.message || "-"}</pre>
                {!!(trace.output?.tool_calls || []).length && (
                  <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--border-subtle)" }}>
                    <div class="text-secondary" style={{ fontSize: "11px", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Tool calls</div>
                    {(trace.output.tool_calls || []).map((tc) => (
                      <div key={tc.id} class="detail-row" style={{ justifyContent: "flex-start", gap: "12px" }}>
                        <span class="mono" style={{ fontWeight: 500 }}>{tc.name}</span>
                        <div style={{ display: "flex", gap: "6px" }}>
                            <span class={`badge-pill ${tc.permitted ? "success" : "danger"}`}>{tc.permitted ? "permitted" : "denied"}</span>
                            <span class={`badge-pill ${tc.success ? "success" : "warn"}`}>{tc.success ? "success" : "error"}</span>
                            <span class="text-secondary mono" style={{ fontSize: "11px", display: "flex", alignItems: "center" }}>{tc.duration_ms}ms</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'governance' && (
        <div class="tab-content animate-fade-in">
          <div class="drawer-section-header" style={{ marginTop: 0 }}>Decision Logic</div>
          <div class="detail-block">
            <div class="detail-row">
              <span class="detail-label">Execution ID</span>
              <span class="mono">{gov.execution_id || trace.labels?.execution_id || "-"}</span>
            </div>
            <div class="detail-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: "8px", marginTop: "12px" }}>
              <span class="detail-label">Decision Summary</span>
              <div class="mono" style={{ 
                background: "var(--bg-app)", 
                padding: "12px", 
                borderRadius: "6px", 
                width: "100%", 
                whiteSpace: "pre-wrap",
                border: "1px solid var(--border-subtle)",
                fontSize: "12px",
                lineHeight: "1.5",
                color: "var(--text-primary)"
              }}>
                {gov.decision_summary || "-"}
              </div>
            </div>
            <div class="detail-row" style={{ marginTop: "12px" }}>
              <span class="detail-label" title="Shown when a human or policy made an explicit approval">Decision ID</span>
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
            {!!gov.policy_bundle_hash && (
              <div class="detail-row">
                <span class="detail-label">Policy bundle</span>
                <span class="mono" style={{ fontSize: "11px", wordBreak: "break-all" }}>{gov.policy_bundle_hash.substring(0, 16)}…</span>
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

          <div class="drawer-section-header">Risk Assessment</div>
          <div class="detail-block">
            <div class="detail-row">
              <span class="detail-label" title="Score 0–100 (higher = riskier). Low <25, medium 25–50, high 50–75, critical 75+.">Risk Score</span>
              <span title="Score 0–100; higher = riskier" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontWeight: 600 }}>{(gov.risk_score != null ? gov.risk_score : trace.risk?.score) != null ? `${(gov.risk_score ?? trace.risk?.score)}/100` : "—"}</span>
                <span class={`badge-pill ${(gov.risk_level === 'high' || gov.risk_level === 'critical') ? 'warn' : ''}`}>{titleCase((gov.risk_level || trace.risk?.level) ?? "—")}</span>
              </span>
            </div>
            {!!(trace.risk?.factors || []).length && (
              <div style={{ marginTop: "12px", marginBottom: "16px", padding: "12px", background: "var(--bg-app)", borderRadius: "6px", border: "1px solid var(--border-subtle)" }}>
                <div class="text-secondary" style={{ fontSize: "11px", marginBottom: "8px", textTransform: "uppercase" }}>Risk factors</div>
                <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    {(trace.risk.factors || []).map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
            
            <div class="detail-row" style={{ marginTop: "16px", borderTop: "1px solid var(--border-subtle)", paddingTop: "16px" }}>
              <span class="detail-label">Scope Granted</span>
              <span class="mono">
                steps {trace.granted_scope?.max_steps ?? "—"} · cost {trace.granted_scope?.max_cost ?? "—"}
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Scope Used</span>
              <span class="mono">
                steps {trace.used_scope?.step_count ?? "—"} · cost {trace.used_scope?.actual_cost != null ? Number(trace.used_scope.actual_cost).toFixed(4) : "—"}
              </span>
            </div>
          </div>

          {!!(policyIds || []).length && (
            <>
              <div class="drawer-section-header">Active Policies</div>
              <div class="detail-block">
                <div class="detail-row" style={{ flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
                  <span class="detail-label">Matched Policy IDs</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                      {policyIds.map(id => <span key={id} class="badge-pill">{id}</span>)}
                  </div>
                </div>
                {!!deniedTools.length && (
                  <div style={{ marginTop: "16px", borderTop: "1px solid var(--border-subtle)", paddingTop: "12px" }}>
                    <div class="text-secondary" style={{ fontSize: "12px", marginBottom: "8px" }}>Denied tools</div>
                    {deniedTools.map((d, i) => (
                      <div key={i} class="detail-row" style={{ marginBottom: "6px" }}>
                        <span class="mono">{d.tool}</span>
                        <span class="text-secondary" style={{ fontSize: "12px", maxWidth: "60%", textAlign: "right" }}>
                          {d.policy_id ? `policy: ${d.policy_id}` : "policy"}{d.reason ? ` · ${d.reason}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {isFallbackOnlyTrace(trace) && hasPermission("policy:manage") && (
            <>
              <div class="drawer-section-header">Governance Gap</div>
              <div class="detail-block" style={{ borderLeft: "3px solid var(--accent-warn)", background: "var(--bg-subtle)" }}>
                <p class="text-secondary" style={{ fontSize: "13px", margin: "0 0 12px 0" }}>
                  No governing policy matched this tool. Only the fallback rule applied.
                </p>
                <button
                  class="btn-primary btn-sm"
                  onClick={() => { policyDraftPanel.value = { open: true, trace }; }}
                >
                  Create policy from this trace
                </button>
              </div>
            </>
          )}

          {!!gov.decision_id && (gov.decision_trace?.length > 0) && (
            <>
              <div class="drawer-section-header">Evaluation Log</div>
              <div class="detail-block" style={{ background: "var(--bg-subtle)", border: "1px solid var(--border-panel)", maxHeight: "300px", overflowY: "auto" }}>
                <div style={{ display: "grid", gap: "6px" }}>
                  {gov.decision_trace.map((entry, i) => (
                    <div key={i} class="text-secondary" style={{ fontSize: "11px", padding: "8px 10px", background: "var(--bg-panel)", borderRadius: "6px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span class="mono" style={{ color: "var(--text-primary)", fontWeight: 500 }}>{entry.policy_id}</span>
                        <span>
                          <span style={{ opacity: 0.8 }}>{entry.result}</span>
                          {entry.decision && <span style={{ marginLeft: "6px", fontWeight: "bold" }}>→ {entry.decision}</span>}
                        </span>
                      </div>
                      {entry.explanation && <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{entry.explanation}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {hasPermission("audit:view") && (
            <>
              <div class="drawer-section-header">Audit Tools</div>
              <div class="detail-block" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <button
                  class="btn-secondary btn-sm"
                  onClick={runReplay}
                  disabled={replayLoading}
                  title="Get replay context for this trace (debugging, policy simulation)"
                >
                  {replayLoading ? "Loading…" : "Replay Trace"}
                </button>
                {!!gov.decision_id && (
                <button
                  class="btn-secondary btn-sm"
                  onClick={runSimulate}
                  disabled={simulateLoading}
                  title="Re-run policy evaluation with current policy bundle"
                >
                  {simulateLoading ? "Simulating…" : "Simulate Policy"}
                </button>
                )}
                {replayResult?.error && (
                  <div class="text-danger" style={{ marginTop: "8px", fontSize: "12px", width: "100%" }}>{replayResult.error}</div>
                )}
                {replayResult && !replayResult.error && (
                  <div style={{ marginTop: "12px", padding: "10px", background: "var(--bg-subtle)", borderRadius: "6px", fontSize: "12px", width: "100%" }}>
                    <div class="text-secondary" style={{ marginBottom: "4px" }}>Replay context</div>
                    <div class="mono">{replayResult.message ?? replayResult.status}</div>
                    {replayResult.original_trace && (
                      <div style={{ marginTop: "6px" }}>Trace: {replayResult.original_trace.id?.slice(0, 8)}… · {replayResult.original_trace.steps?.length ?? 0} steps</div>
                    )}
                  </div>
                )}
                {simulateResult?.error && (
                  <div class="text-danger" style={{ marginTop: "8px", fontSize: "12px", width: "100%" }}>{simulateResult.error}</div>
                )}
                {simulateResult && !simulateResult.error && (
                  <div style={{ marginTop: "12px", padding: "10px", background: "var(--bg-subtle)", borderRadius: "6px", fontSize: "12px", width: "100%" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                      <div>
                        <div class="text-secondary" style={{ marginBottom: "4px" }}>Original</div>
                        <div class="mono">decision: {simulateResult.original?.decision ?? "—"}</div>
                        <div class="mono">risk: {simulateResult.original?.risk_score ?? "—"}/100 ({simulateResult.original?.risk_level ?? "—"})</div>
                      </div>
                      <div>
                        <div class="text-secondary" style={{ marginBottom: "4px" }}>Simulated (current policies)</div>
                        <div class="mono">decision: {simulateResult.simulated?.decision ?? "—"}</div>
                        <div class="mono">policy_bundle_hash: {(simulateResult.simulated?.policy_bundle_hash ?? "").slice(0, 16)}…</div>
                      </div>
                    </div>
                    {simulateResult.original?.decision !== simulateResult.simulated?.decision && (
                      <div class="badge-pill warn" style={{ marginTop: "8px" }}>Decision would change</div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'execution' && (
        <div class="tab-content animate-fade-in">
          <div class="drawer-section-header" style={{ marginTop: 0 }}>System Metadata</div>
          <div class="detail-block">
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
            {(trace.agent_id || trace.labels?.agent_id) && (
              <div class="detail-row">
                <span class="detail-label" title="Agent identifier for per-agent policy matching">Agent ID</span>
                <span class="mono">{trace.agent_id || trace.labels?.agent_id}</span>
              </div>
            )}
            <div class="detail-row" style={{ marginTop: "16px", borderTop: "1px solid var(--border-subtle)", paddingTop: "16px" }}>
              <span class="detail-label" title="Tools or capabilities the agent requested to use">Requested Caps</span>
              <span class="mono" style={{ maxWidth: "60%", textAlign: "right" }}>{requested.join(", ") || "-"}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Tools</span>
              <span class="mono" style={{ maxWidth: "60%", textAlign: "right", wordBreak: "break-all" }}>{(trace.tool_names || []).join(", ") || "-"}</span>
            </div>
          </div>

          <div class="drawer-section-header">Trace Flow</div>
          <div class="exec-graph">
            <div class="exec-graph-node exec-graph-prompt">
              <span class="exec-graph-label">Prompt</span>
              <span class="exec-graph-detail">Input → agent</span>
            </div>
            <div class="exec-graph-node exec-graph-policy">
              <span class="exec-graph-label">Policy decision</span>
              <span class="exec-graph-detail"><GovernanceBadge decision={gov.decision || "unknown"} /></span>
            </div>
            {(gov.decision === "approved_local" || gov.decision === "pending_approval") && (
              <div class="exec-graph-node exec-graph-approval">
                <span class="exec-graph-label">Approval</span>
                <span class="exec-graph-detail">{gov.decision === "approved_local" ? "Local approval" : "Pending"}</span>
              </div>
            )}
            {(() => {
              const steps = trace.steps || [];
              const nodes = [];
              for (let i = 0; i < steps.length; i++) {
                const s = steps[i];
                const d = s?.data || {};
                if (s.type === "llm_call") {
                  const prev = nodes[nodes.length - 1];
                  if (prev?.type === "reasoning") {
                    prev.count++;
                  } else {
                    nodes.push({ type: "reasoning", count: 1 });
                  }
                } else if (s.type === "tool_call") {
                  nodes.push({ type: "tool_call", tool: d.toolName || "tool", permitted: d.permitted });
                } else if (s.type === "tool_result") {
                  const prev = nodes[nodes.length - 1];
                  if (prev?.type === "tool_call") {
                    prev.result = d.success ? "success" : "error";
                  } else {
                    nodes.push({ type: "tool_result", tool: d.toolName || "tool", success: d.success });
                  }
                } else if (s.type === "error") {
                  nodes.push({ type: "error", code: d.code });
                }
              }
              return nodes.map((n, i) => {
                if (n.type === "reasoning") {
                  return (
                    <div key={`r-${i}`} class="exec-graph-node exec-graph-reasoning">
                      <span class="exec-graph-label">Reasoning</span>
                      <span class="exec-graph-detail">{`${n.count} LLM call${n.count !== 1 ? "s" : ""}`}</span>
                    </div>
                  );
                }
                if (n.type === "tool_call") {
                  return (
                    <div key={`t-${i}`} class="exec-graph-node exec-graph-tool">
                      <span class="exec-graph-label">Tool call</span>
                      <span class="exec-graph-detail mono">{`${n.tool} · ${n.permitted ? "permitted" : "denied"}${n.result ? ` → ${n.result}` : ""}`}</span>
                    </div>
                  );
                }
                if (n.type === "tool_result") {
                  return (
                    <div key={`tr-${i}`} class="exec-graph-node exec-graph-exec">
                      <span class="exec-graph-label">Execution</span>
                      <span class="exec-graph-detail mono">{`${n.tool} · ${n.success ? "success" : "error"}`}</span>
                    </div>
                  );
                }
                if (n.type === "error") {
                  return (
                    <div key={`e-${i}`} class="exec-graph-node exec-graph-error">
                      <span class="exec-graph-label">Error</span>
                      <span class="exec-graph-detail">{n.code || "error"}</span>
                    </div>
                  );
                }
                return null;
              });
            })()}
          </div>

          <div class="drawer-section-header">
            Step Breakdown ({(trace.steps || []).length})
          </div>
          <div class="steps">
              {(trace.steps || []).map((s, i) => (
              <div key={i} class="step">
                  <div class="detail-row">
                  <strong>{stepTitle(s)}</strong>
                  <span class="mono text-secondary">{s.duration_ms}ms</span>
                  </div>
                  {stepActionPreview(s) && (
                    <pre class="mono" style={{ margin: "6px 0", padding: "8px", background: "var(--bg-panel)", borderRadius: "4px", fontSize: "12px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{stepActionPreview(s)}</pre>
                  )}
                  <div class="text-secondary" style={{ fontSize: "12px" }}>{s.timestamp}</div>
                  <details style={{ marginTop: "6px" }}>
                  <summary class="text-secondary" style={{ fontSize: "12px", cursor: "pointer" }}>View step data</summary>
                  <pre class="mono" style={{ marginTop: "8px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{json(s.data)}</pre>
                  </details>
              </div>
              ))}
          </div>
        </div>
      )}

      {activeTab === 'json' && (
        <div class="tab-content animate-fade-in">
          <div class="detail-block">
            <pre class="mono" style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "12px", wordBreak: "break-word", overflowX: "hidden" }}>
              {JSON.stringify(trace, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}


export function openTrace(id) {
  drawerTraceId.value = id;
  drawerOpen.value = true;
}
