import { useEffect, useState } from "preact/hooks";
import { tenantId, selectedWorkspace, formatCost, showToast } from "../state.js";
import { api, buildParams } from "../api.js";
import { copy } from "../copy.js";
import { StatCard } from "../components/stat-card.jsx";
import { ActivityIcon, AlertTriangleIcon, DollarIcon, ThumbsUpIcon, RefreshIcon } from "../components/icons.jsx";
import { openTrace } from "../components/drawer.jsx";
import { TraceCard } from "../components/trace-card.jsx";

export function DashboardView() {
  const [traces, setTraces] = useState({ count: "-", breakdown: "Loading..." });
  const [risk, setRisk] = useState({ high: "-", breakdown: "Loading..." });
  const [cost, setCost] = useState({ total: "-", bars: [] });
  const [approvals, setApprovals] = useState({ count: "-", hint: "Loading..." });
  const [highRisk, setHighRisk] = useState([]);

  const load = async () => {
    const results = await Promise.allSettled([
      loadTraces(),
      loadRisk(),
      loadCost(),
      loadApprovals(),
      loadHighRisk(),
    ]);
    return results.every((r) => r.status === "fulfilled");
  };

  const handleRefresh = async () => {
    const ok = await load();
    showToast(ok ? "Dashboard refreshed" : "Refresh failed", ok ? "success" : "error");
  };

  useEffect(load, [tenantId.value, selectedWorkspace.value]);

  async function loadTraces() {
    try {
      const params = buildParams({ limit: 200, start_date: new Date().toISOString().split("T")[0] });
      const data = await api(`/ops/api/traces?${params}`);
      const t = data.traces || [];
      const s = t.filter((x) => x.status === "success").length;
      const e = t.filter((x) => x.status === "error").length;
      setTraces({ count: t.length, breakdown: `${s} Success · ${e} Error` });
    } catch {
      setTraces({ count: "-", breakdown: "" });
      throw new Error("traces");
    }
  }

  async function loadRisk() {
    try {
      const data = await api(`/ops/api/dashboards/risk?${buildParams()}`);
      const l = data.dashboard?.levels || {};
      setRisk({ high: (l.high || 0) + (l.critical || 0), breakdown: `${l.medium || 0} Medium · ${l.low || 0} Low` });
    } catch {
      setRisk({ high: "-", breakdown: "" });
      throw new Error("risk");
    }
  }

  async function loadCost() {
    try {
      const data = await api(`/ops/api/dashboards/cost?${buildParams()}`);
      const daily = data.dashboard?.daily || [];
      const total = daily.reduce((a, d) => a + (d.total_cost || 0), 0);
      const max = Math.max(...daily.map((d) => d.total_cost), 0.0001);
      setCost({ total: formatCost(total), bars: daily.slice(-7).map((d) => Math.max(10, (d.total_cost / max) * 100)) });
    } catch {
      setCost({ total: "-", bars: [] });
      throw new Error("cost");
    }
  }

  async function loadApprovals() {
    try {
      const data = await api(`/ops/api/decisions?${buildParams({ status: "pending" })}`);
      const c = data.decisions?.length || 0;
      setApprovals({ count: c, hint: c ? "Action required" : "All clear" });
    } catch {
      setApprovals({ count: "-", hint: "" });
      throw new Error("approvals");
    }
  }

  async function loadHighRisk() {
    try {
      const data = await api(`/ops/api/traces?${buildParams({ limit: 50 })}`);
      const risky = (data.traces || []).filter((t) => t.risk?.level === "high" || t.risk?.level === "critical");
      setHighRisk(risky.slice(0, 5));
    } catch {
      setHighRisk([]);
      throw new Error("highRisk");
    }
  }

return (
    <section>
      <div class="dashboard-grid">
        <StatCard icon={<ActivityIcon />} variant="info" label="Traces Today" tooltip={copy.tooltips.dashboard.tracesToday} value={traces.count} meta={traces.breakdown} href={`#traces?start_date=${new Date().toISOString().split("T")[0]}`} />
        <StatCard icon={<AlertTriangleIcon />} variant="warn" label="Risk Score" tooltip={copy.tooltips.dashboard.riskScore} value={risk.high} meta={risk.breakdown} href="#traces?risk_level=high" />
        <StatCard icon={<DollarIcon />} variant="success" label="Cost (7d)" tooltip={copy.tooltips.dashboard.cost7d} value={cost.total} href="#cost?range=7d">
          {cost.bars.length > 0 && (
            <div class="spark-bars">
              {cost.bars.map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}
            </div>
          )}
        </StatCard>
        <StatCard icon={<ThumbsUpIcon />} variant="primary" label="Pending Decisions" tooltip={copy.tooltips.dashboard.pendingDecisions} value={approvals.count} meta={approvals.hint} href="#approvals" />
      </div>

      <div class="panel">
        <div class="panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <h3>Recent High Risk Traces</h3>
            <a href="#traces?risk_level=high" class="text-secondary" style={{ fontSize: "12px", textDecoration: "none" }}>View all</a>
          </div>
          <button class="btn-secondary btn-sm" title="Refresh" onClick={handleRefresh}>
            <RefreshIcon width={14} /> Refresh
          </button>
        </div>
        <div class="panel-list">
          {!highRisk.length && <div class="empty-state">No high risk traces found.</div>}
          {highRisk.map((t) => (
            <TraceCard key={t.id} trace={t} onClick={() => openTrace(t.id)} />
          ))}
        </div>
      </div>
    </section>
  );
}
