import { useEffect, useState, useMemo } from "preact/hooks";
import { tenantId, selectedWorkspace, formatCost, showToast } from "../state.js";
import { api, buildParams } from "../api.js";
import { openTrace } from "../components/drawer.jsx";
import { ExecutionBadge, RiskBadge, GovernanceBadge } from "../components/badge.jsx";
import { RefreshIcon } from "../components/icons.jsx";
import { formatTimestamp } from "../copy.js";

const INCIDENT_RESPONSE_TOOLTIP =
  "Traces with execution errors or denied governance decisions. Click a row to open the trace detail.";

const DEFAULT_FILTERS = { status: "", governance: "", risk: "", trace_id: "", start_date: "", end_date: "" };

export function IncidentsView() {
  const [loading, setLoading] = useState(true);
  const [allIncidents, setAllIncidents] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  const load = async (filtersOverride) => {
    const f = filtersOverride ?? filters;
    setLoading(true);
    try {
      const baseParams = buildParams({ limit: 200 });
      if (f.start_date) baseParams.set("start_date", f.start_date);
      if (f.end_date) baseParams.set("end_date", f.end_date);
      const [errorRes, denyRes] = await Promise.all([
        api(`/ops/api/traces?${baseParams}&status=error`),
        api(`/ops/api/traces?${baseParams}&governance_decision=deny`)
      ]);
      const byId = new Map();
      for (const t of (errorRes.traces || [])) byId.set(t.id, t);
      for (const t of (denyRes.traces || [])) byId.set(t.id, t);
      const incidentTraces = [...byId.values()];
      setAllIncidents(incidentTraces);
      return true;
    } catch (e) {
      console.error("Load incidents error:", e);
      setAllIncidents([]);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const traces = useMemo(() => {
    let out = allIncidents;
    if (filters.status) out = out.filter((t) => t.status === filters.status);
    if (filters.governance) {
      const g = filters.governance;
      if (g === "allow") out = out.filter((t) => t.governance?.decision === "allow" || t.governance?.decision === "approved_local");
      else if (g === "deny") out = out.filter((t) => t.governance?.decision === "deny");
    }
    if (filters.risk) out = out.filter((t) => (t.governance?.risk_level || t.risk?.level) === filters.risk);
    if (filters.trace_id) {
      const q = filters.trace_id.trim().toLowerCase();
      out = out.filter((t) => t.id.toLowerCase().includes(q));
    }
    return out;
  }, [allIncidents, filters.status, filters.governance, filters.risk, filters.trace_id]);

  const handleRefresh = async () => {
    const ok = await load();
    showToast(ok ? "Incidents refreshed" : "Refresh failed", ok ? "success" : "error");
  };

  useEffect(() => { load(); }, [tenantId.value, selectedWorkspace.value, filters.start_date, filters.end_date]);

  const handleSearch = () => load();
  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    load(DEFAULT_FILTERS);
  };

  return (
    <section class="incidents-view">
      <div class="panel">
        <div class="toolbar incidents-toolbar">
          <div class="toolbar-group" style={{ flex: 1, gap: "8px", flexWrap: "wrap" }}>
            <h3 class="incidents-toolbar-title" data-tooltip={INCIDENT_RESPONSE_TOOLTIP}>Incident Response</h3>
            <select class="select-sm incidents-select" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} title="Execution status">
              <option value="">Status</option>
              <option value="error">Error</option>
            </select>
            <select class="select-sm incidents-select" value={filters.governance} onChange={(e) => setFilters((f) => ({ ...f, governance: e.target.value }))} title="Governance decision">
              <option value="">Governance</option>
              <option value="allow">Approved</option>
              <option value="deny">Denied</option>
            </select>
            <select class="select-sm incidents-select" value={filters.risk} onChange={(e) => setFilters((f) => ({ ...f, risk: e.target.value }))} title="Risk level">
              <option value="">Risk</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <input
              type="text"
              class="input-sm incidents-input"
              placeholder="Trace ID"
              value={filters.trace_id || ""}
              onInput={(e) => setFilters((f) => ({ ...f, trace_id: e.target.value }))}
              title="Partial trace ID match"
            />
            <input
              type="date"
              class="input-sm incidents-date"
              value={filters.start_date || ""}
              onInput={(e) => setFilters((f) => ({ ...f, start_date: e.target.value || "" }))}
              title="Start date"
            />
            <input
              type="date"
              class="input-sm incidents-date"
              value={filters.end_date || ""}
              onInput={(e) => setFilters((f) => ({ ...f, end_date: e.target.value || "" }))}
              title="End date"
            />
            <button class="btn-ghost btn-sm" onClick={handleReset} title="Clear filters">Reset</button>
            <button class="btn-primary btn-sm" onClick={handleSearch}>Search</button>
            <button class="btn-secondary btn-sm" onClick={handleRefresh} title="Refresh">
              <RefreshIcon width={14} /> Refresh
            </button>
          </div>
        </div>

        <div class="table-container">
          {loading && <div class="empty-state"><div class="spinner" /></div>}
          {!loading && !traces.length && (
            <div class="empty-state">
              <div class="empty-icon">✓</div>
              <div>
                {allIncidents.length > 0
                  ? "No incidents match your filters."
                  : "No incidents found. No denied or error traces in the current scope."}
              </div>
            </div>
          )}
          {!loading && traces.length > 0 && (
            <table class="data-table">
              <thead>
                <tr>
                  <th>Trace ID</th>
                  <th>Timestamp</th>
                  <th>Status</th>
                  <th>Error</th>
                  <th>Governance</th>
                  <th>Risk</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {traces.map((t) => (
                  <tr key={t.id} onClick={() => openTrace(t.id)} style={{ cursor: "pointer" }}>
                    <td class="mono" title={t.id}>{t.id.slice(0, 8)}…</td>
                    <td class="text-secondary" title={formatTimestamp(t.started_at)}>
                      {formatTimestamp(t.started_at)}
                    </td>
                    <td><ExecutionBadge status={t.status} /></td>
                    <td class="text-secondary" title={t.error || undefined} style={{ maxWidth: "240px", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.error || "—"}
                    </td>
                    <td><GovernanceBadge decision={t.governance?.decision} /></td>
                    <td><RiskBadge level={t.governance?.risk_level || t.risk?.level} /></td>
                    <td class="text-right">{formatCost(t.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
