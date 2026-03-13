import { useEffect, useState } from "preact/hooks";
import { tenantId, selectedWorkspace, formatCost, routeQuery, currentRoute, showToast } from "../state.js";
import { api, apiPost, buildParams } from "../api.js";
import { copy, formatTimestamp } from "../copy.js";
import { ExecutionBadge, RiskBadge, GovernanceBadge } from "../components/badge.jsx";
import { RefreshIcon, XIcon } from "../components/icons.jsx";
import { TRUST_LABEL, titleCase } from "../labelColors.js";
import { openTrace } from "../components/drawer.jsx";

function getHashQuery() {
  const raw = (location.hash || "").replace("#", "");
  const [, query] = raw.includes("?") ? raw.split("?") : ["", ""];
  return query || "";
}

function getInitialFiltersFromHash() {
  const q = getHashQuery();
  if (!q) return { status: "", risk: "", adapter: "", agent_id: "", start_date: "", end_date: "", governance: "" };
  const params = new URLSearchParams(q);
  const risk = params.get("risk_level");
  const adapter = params.get("adapter_id") || "";
  const agentId = params.get("agent_id") || "";
  const startDate = params.get("start_date") || "";
  const endDate = params.get("end_date") || "";
  const governance = params.get("governance_decision") || "";
  return {
    status: params.get("status") || "",
    risk: risk && ["low", "medium", "high", "critical"].includes(risk) ? risk : "",
    adapter,
    agent_id: agentId,
    start_date: startDate,
    end_date: endDate,
    governance: governance === "allow" || governance === "deny" ? governance : "",
  };
}

export function TracesView() {
  const [traces, setTraces] = useState([]);
  const [adapters, setAdapters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState({ limit: 50, offset: 0 });
  const [filters, setFilters] = useState(getInitialFiltersFromHash);
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffBaseId, setDiffBaseId] = useState("");
  const [diffCompareId, setDiffCompareId] = useState("");
  const [diffResult, setDiffResult] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // Sync filters from hash when navigating to traces with query params (e.g. from dashboard KPI links)
  useEffect(() => {
    if (currentRoute.value !== "traces" || !routeQuery.value) return;
    setFilters(getInitialFiltersFromHash());
  }, [currentRoute.value, routeQuery.value]);

  // Clear hash query after reading so URL shows #traces without duplicate params
  useEffect(() => {
    if (!routeQuery.value) return;
    routeQuery.value = "";
    if (location.hash.includes("?")) location.hash = "traces";
  }, []);

  useEffect(() => {
    const loadAdapters = async () => {
      try {
        const data = await api(`/ops/api/adapters?${buildParams()}`);
        setAdapters(data.adapters || []);
      } catch {
        setAdapters([]);
      }
    };
    loadAdapters();
  }, [tenantId.value, selectedWorkspace.value]);

  const load = async () => {
    setLoading(true);
    try {
      const params = buildParams({ limit: page.limit, offset: page.offset });
      if (filters.status) params.set("status", filters.status);
      if (filters.risk) params.set("risk_level", filters.risk);
      if (filters.adapter) params.set("adapter_id", filters.adapter);
      if (filters.agent_id) params.set("agent_id", filters.agent_id);
      if (filters.start_date) params.set("start_date", filters.start_date);
      if (filters.end_date) params.set("end_date", filters.end_date);
      if (filters.governance) params.set("governance_decision", filters.governance);
      const data = await api(`/ops/api/traces?${params}`);
      setTraces(data.traces || []);
      return true;
    } catch (e) {
      console.error("Load traces error:", e);
      setTraces([]);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    const ok = await load();
    showToast(ok ? "Traces refreshed" : "Failed to load traces", ok ? "success" : "error");
  };

  useEffect(() => { load(); }, [tenantId.value, selectedWorkspace.value, page.offset, page.limit, filters.status, filters.risk, filters.adapter, filters.agent_id, filters.start_date, filters.end_date, filters.governance]);

  const search = () => { setPage((p) => ({ ...p, offset: 0 })); load(); };
  const reset = () => { setFilters({ status: "", risk: "", adapter: "", agent_id: "", start_date: "", end_date: "", governance: "" }); setPage({ limit: 50, offset: 0 }); };

  const runDiff = async () => {
    if (!diffBaseId.trim() || !diffCompareId.trim()) {
      showToast("Enter both base and compare trace IDs", "warn");
      return;
    }
    setDiffLoading(true);
    setDiffResult(null);
    try {
      const params = buildParams();
      const res = await apiPost(`/ops/api/traces/diff?${params}`, {
        base_trace_id: diffBaseId.trim(),
        compare_trace_id: diffCompareId.trim(),
        include_summary: true,
      });
      setDiffResult(res);
    } catch (e) {
      setDiffResult({ error: e?.message || "Diff failed" });
    } finally {
      setDiffLoading(false);
    }
  };

  const pageNum = Math.floor(page.offset / page.limit) + 1;

  return (
    <section>
      <div class="panel full-height">
        <div class="toolbar" style={{ flexWrap: "wrap", gap: "12px", padding: "12px 24px" }}>
          <div class="toolbar-group" style={{ flex: 1, gap: "8px" }}>
            <select class="select-sm" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="">Status: All</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
            </select>
            <select class="select-sm" value={filters.risk} onChange={(e) => setFilters((f) => ({ ...f, risk: e.target.value }))}>
              <option value="">Risk: All</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <select class="select-sm" value={filters.adapter} onChange={(e) => setFilters((f) => ({ ...f, adapter: e.target.value }))}>
              <option value="">Adapter: All</option>
              {[...new Set(adapters.map((a) => a.adapter_id))].map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
            <select class="select-sm" value={filters.governance} onChange={(e) => setFilters((f) => ({ ...f, governance: e.target.value }))}>
              <option value="">Governance: All</option>
              <option value="allow">Approved</option>
              <option value="deny">Denied</option>
            </select>

            <div style={{ width: "1px", height: "20px", background: "var(--border-subtle)", margin: "0 4px" }} />

            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                class="input-sm"
                placeholder="Agent ID"
                value={filters.agent_id || ""}
                onChange={(e) => setFilters((f) => ({ ...f, agent_id: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && search()}
                style={{ width: "120px" }}
              />
              <button class="btn-primary btn-sm" onClick={search}>Search</button>
            </div>

            <button class="btn-ghost btn-sm" onClick={() => { reset(); load(); }} title="Clear filters">Reset</button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {(filters.start_date || filters.end_date) && (
              <span class="text-secondary text-xs" style={{ marginRight: "4px" }}>
                {filters.start_date || "…"} → {filters.end_date || "…"}
              </span>
            )}
            <button class="btn-secondary btn-sm" onClick={() => setDiffModalOpen(true)} title="Compare two traces">
              Trace diff
            </button>
            <button class="btn-secondary btn-sm" onClick={handleRefresh} title="Refresh">
              <RefreshIcon width={14} /> Refresh
            </button>
          </div>
        </div>

        {diffModalOpen && (
          <div class="modal">
            <div class="modal-backdrop" onClick={() => { setDiffModalOpen(false); setDiffResult(null); }} />
            <div class="modal-dialog" style={{ maxWidth: "560px" }}>
              <div class="modal-header">
                <h3>Trace diff</h3>
                <button class="btn-icon" onClick={() => { setDiffModalOpen(false); setDiffResult(null); }}><XIcon /></button>
              </div>
              <div class="modal-body">
                <p class="text-secondary" style={{ fontSize: "13px", marginBottom: "12px" }}>Compare two traces to see policy, risk, and execution differences.</p>
                <div class="form-group">
                  <label>Base trace ID</label>
                  <input
                    type="text"
                    class="input-sm"
                    placeholder="Trace ID (e.g. from list)"
                    value={diffBaseId}
                    onInput={(e) => setDiffBaseId(e.target.value)}
                  />
                </div>
                <div class="form-group">
                  <label>Compare trace ID</label>
                  <input
                    type="text"
                    class="input-sm"
                    placeholder="Trace ID"
                    value={diffCompareId}
                    onInput={(e) => setDiffCompareId(e.target.value)}
                  />
                </div>
                {diffResult?.error && (
                  <div class="text-danger" style={{ marginBottom: "12px", fontSize: "13px" }}>{diffResult.error}</div>
                )}
                {diffResult && !diffResult.error && (
                  <div style={{ marginTop: "12px", padding: "12px", background: "var(--bg-subtle)", borderRadius: "6px", fontSize: "13px" }}>
                    {diffResult.summary_text && (
                      <div style={{ marginBottom: "8px" }}>{diffResult.summary_text}</div>
                    )}
                    {diffResult.diff && (
                      <pre class="mono" style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "12px", maxHeight: "200px", overflow: "auto" }}>
                        {JSON.stringify(diffResult.diff, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
              <div class="modal-footer" style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button class="btn-ghost" onClick={() => { setDiffModalOpen(false); setDiffResult(null); }}>Close</button>
                <button class="btn-primary" onClick={runDiff} disabled={diffLoading}>
                  {diffLoading ? "Comparing…" : "Compare"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th data-tooltip={copy.tooltips.traces.traceId}>Trace ID</th>
                <th data-tooltip={copy.tooltips.traces.timestamp}>Timestamp</th>
                <th data-tooltip={copy.tooltips.traces.risk}>Risk</th>
                <th data-tooltip={copy.tooltips.traces.outcome}>Outcome</th>
                <th data-tooltip={copy.tooltips.traces.governance}>Governance</th>
                <th data-tooltip={copy.tooltips.traces.role}>Agent Role</th>
                <th data-tooltip={copy.tooltips.traces.requested}>Requested</th>
                <th data-tooltip="Winning policy that allowed or denied this trace; or scope limits when set">Policy</th>
                <th data-tooltip={copy.tooltips.traces.trust}>Trust</th>
                <th data-tooltip={copy.tooltips.traces.env}>Env</th>
                <th class="text-right" data-tooltip={copy.tooltips.traces.cost}>Cost</th>
                <th class="text-right" data-tooltip={copy.tooltips.traces.duration}>Dur</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colspan="12"><div class="empty-state loading"><div class="spinner" /><div>Loading traces...</div></div></td></tr>
              )}
              {!loading && !traces.length && (
                <tr><td colspan="12" class="empty-state">No traces found</td></tr>
              )}
              {!loading && traces.map((t) => (
                <tr key={t.id} onClick={() => openTrace(t.id)} style={{ cursor: "pointer" }}>
                  <td class="mono" title={t.id}>{t.id.slice(0, 8)}…</td>
                  <td class="text-secondary" title={t.started_at}>
                    {formatTimestamp(t.started_at)}
                  </td>
                  <td title={t.governance?.risk_score != null ? `Score: ${t.governance.risk_score}/100` : t.risk?.score != null ? `Score: ${t.risk.score}/100` : undefined}>
                    <RiskBadge level={t.governance?.risk_level || t.risk?.level} />
                  </td>
                  <td class="col-outcome"><ExecutionBadge status={t.status} /></td>
                  <td><GovernanceBadge decision={t.governance?.decision} /></td>
                  <td>{t.agent_role || "-"}</td>
                  <td class="col-requested" title={t.action_preview || (t.requested_capabilities || []).join(", ")}>
                    <div class="mono" style={{ fontSize: "12px" }}>
                      {(t.requested_capabilities || []).join(", ") || "-"}
                    </div>
                    {t.action_preview && (
                      <div class="text-secondary mono" style={{ fontSize: "11px", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "220px" }}>
                        {t.action_preview}
                      </div>
                    )}
                  </td>
                  <td class="col-policy-scope" title={t.governance?.decision_summary || "-"}>
                    <div class="text-secondary" style={{ fontSize: "12px", maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {(() => {
                        const sd = t.governance?.scope_delta || {};
                        const hasScope = (sd.cost_used != null && sd.cost_max != null) || (sd.steps_used != null && sd.steps_max != null);
                        if (hasScope) {
                          const cost = sd.cost_used != null && sd.cost_max != null ? `${Number(sd.cost_used).toFixed(2)}/${sd.cost_max}` : "—";
                          const steps = sd.steps_used != null && sd.steps_max != null ? `${sd.steps_used}/${sd.steps_max}` : "—";
                          return `cost ${cost} · steps ${steps}`;
                        }
                        const summary = t.governance?.decision_summary || "";
                        const match = summary.match(/policy:\s*([^,)]+)/);
                        const policy = match ? match[1].trim() : (t.governance?.policy_ids || [])[0];
                        return policy ? String(policy) : (summary ? summary.slice(0, 50) + (summary.length > 50 ? "…" : "") : "-");
                      })()}
                    </div>
                  </td>
                  <td title="Local/self-attested">{t.trust_status ? (TRUST_LABEL[t.trust_status] ?? titleCase(t.trust_status)) : "-"}</td>
                  <td>{t.environment}</td>
                  <td class="text-right">{formatCost(t.cost)}</td>
                  <td class="text-right">{t.duration_ms || "-"}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div class="pagination-bar">
          <div class="pagination-info">Showing <span>Page {pageNum}</span></div>
          <div class="pagination-controls">
            <button class="btn-secondary btn-sm" disabled={page.offset === 0} onClick={() => setPage((p) => ({ ...p, offset: Math.max(0, p.offset - p.limit) }))}>Previous</button>
            <button class="btn-secondary btn-sm" onClick={() => setPage((p) => ({ ...p, offset: p.offset + p.limit }))}>Next</button>
            <select class="select-sm" value={page.limit} onChange={(e) => setPage({ limit: Number(e.target.value), offset: 0 })}>
              <option value="25">25 / page</option>
              <option value="50">50 / page</option>
              <option value="100">100 / page</option>
            </select>
          </div>
        </div>
      </div>
    </section>
  );
}
