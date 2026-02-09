import { useEffect, useState } from "preact/hooks";
import { tenantId, selectedWorkspace, formatCost, routeQuery, showToast } from "../state.js";
import { api, buildParams } from "../api.js";
import { copy } from "../copy.js";
import { ExecutionBadge, RiskBadge, GovernanceBadge } from "../components/badge.jsx";
import { RefreshIcon } from "../components/icons.jsx";
import { openTrace } from "../components/drawer.jsx";

function getHashQuery() {
  const raw = (location.hash || "").replace("#", "");
  const [, query] = raw.includes("?") ? raw.split("?") : ["", ""];
  return query || "";
}

function getInitialFiltersFromHash() {
  const q = getHashQuery();
  if (!q) return { status: "", risk: "", start_date: "", end_date: "" };
  const params = new URLSearchParams(q);
  const risk = params.get("risk_level");
  const startDate = params.get("start_date") || "";
  const endDate = params.get("end_date") || "";
  return {
    status: "",
    risk: risk && ["low", "medium", "high", "critical"].includes(risk) ? risk : "",
    start_date: startDate,
    end_date: endDate,
  };
}

export function TracesView() {
  const [traces, setTraces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState({ limit: 50, offset: 0 });
  const [filters, setFilters] = useState(getInitialFiltersFromHash);

  // Clear hash query after reading so URL shows #traces without duplicate params
  useEffect(() => {
    if (!routeQuery.value) return;
    routeQuery.value = "";
    if (location.hash.includes("?")) location.hash = "traces";
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const params = buildParams({ limit: page.limit, offset: page.offset });
      if (filters.status) params.set("status", filters.status);
      if (filters.risk) params.set("risk_level", filters.risk);
      if (filters.start_date) params.set("start_date", filters.start_date);
      if (filters.end_date) params.set("end_date", filters.end_date);
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

  useEffect(() => { load(); }, [tenantId.value, selectedWorkspace.value, page.offset, page.limit, filters.status, filters.risk, filters.start_date, filters.end_date]);

  const search = () => { setPage((p) => ({ ...p, offset: 0 })); load(); };
  const reset = () => { setFilters({ status: "", risk: "", start_date: "", end_date: "" }); setPage({ limit: 50, offset: 0 }); };

  const pageNum = Math.floor(page.offset / page.limit) + 1;

  return (
    <section>
      <div class="panel full-height">
        <div class="toolbar">
          <div class="toolbar-group">
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
            {(filters.start_date || filters.end_date) && (
              <span class="text-secondary text-xs" style={{ alignSelf: "center" }}>
                Date: {filters.start_date || "…"} → {filters.end_date || "…"}
              </span>
            )}
            <button class="btn-primary btn-sm" onClick={search}>Search</button>
            <button class="btn-ghost btn-sm" onClick={() => { reset(); load(); }}>Reset</button>
          </div>
          <div class="toolbar-group">
            <button class="btn-icon" onClick={handleRefresh} title="Refresh"><RefreshIcon /></button>
          </div>
        </div>

        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th data-tooltip={copy.tooltips.traces.traceId}>Trace ID</th>
                <th data-tooltip={copy.tooltips.traces.env}>Env</th>
                <th data-tooltip={copy.tooltips.traces.role}>Agent Role</th>
                <th data-tooltip={copy.tooltips.traces.governance}>Governance</th>
                <th data-tooltip={copy.tooltips.traces.requested}>Requested</th>
                <th data-tooltip={copy.tooltips.traces.policyScope}>Policy & Scope</th>
                <th data-tooltip={copy.tooltips.traces.outcome}>Outcome</th>
                <th data-tooltip={copy.tooltips.traces.risk}>Risk</th>
                <th data-tooltip={copy.tooltips.traces.trust}>Trust</th>
                <th class="text-right" data-tooltip={copy.tooltips.traces.cost}>Cost</th>
                <th class="text-right" data-tooltip={copy.tooltips.traces.duration}>Dur</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colspan="11"><div class="empty-state loading"><div class="spinner" /><div>Loading traces...</div></div></td></tr>
              )}
              {!loading && !traces.length && (
                <tr><td colspan="11" class="empty-state">No traces found</td></tr>
              )}
              {!loading && traces.map((t) => (
                <tr key={t.id} onClick={() => openTrace(t.id)} style={{ cursor: "pointer" }}>
                  <td class="mono" title={t.id}>{t.id.slice(0, 8)}…</td>
                  <td>{t.environment}</td>
                  <td>{t.agent_role || "-"}</td>
                  <td><GovernanceBadge decision={t.governance?.decision} /></td>
                  <td class="mono" style={{ maxWidth: "200px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={(t.requested_capabilities || []).join(", ")}>
                    {(t.requested_capabilities || []).join(", ") || "-"}
                  </td>
                  <td class="col-policy-scope" title={(() => {
                    const sd = t.governance?.scope_delta || {};
                    const cost = sd.cost_used != null && sd.cost_max != null ? `${Number(sd.cost_used).toFixed(4)}/${sd.cost_max}` : "—";
                    const steps = sd.steps_used != null && sd.steps_max != null ? `${sd.steps_used}/${sd.steps_max}` : "—";
                    const policies = (t.governance?.policy_ids || []).join(", ");
                    return `cost ${cost} · steps ${steps}${policies ? ` · policy: ${policies}` : ""}`;
                  })()}>
                    <div class="text-secondary" style={{ fontSize: "12px" }}>
                      {(() => {
                        const sd = t.governance?.scope_delta || {};
                        const cost = sd.cost_used != null && sd.cost_max != null ? `${Number(sd.cost_used).toFixed(4)}/${sd.cost_max}` : "—";
                        const steps = sd.steps_used != null && sd.steps_max != null ? `${sd.steps_used}/${sd.steps_max}` : "—";
                        const policies = (t.governance?.policy_ids || []).slice(0, 2).join(", ");
                        return `cost ${cost} · steps ${steps}${policies ? ` · policy: ${policies}${(t.governance?.policy_ids || []).length > 2 ? "…" : ""}` : ""}`;
                      })()}
                    </div>
                  </td>
                  <td class="col-outcome"><ExecutionBadge status={t.status} /></td>
                  <td><RiskBadge level={t.risk?.level} /></td>
                  <td title="Local/self-attested">{t.trust_status || "-"}</td>
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
