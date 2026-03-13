import { useEffect, useState } from "preact/hooks";
import { tenantId, selectedWorkspace, formatCost } from "../state.js";
import { api, buildParams } from "../api.js";
import { copy } from "../copy.js";
import { StatCard } from "../components/stat-card.jsx";
import { Hero } from "../components/hero.jsx";
import { ActivityIcon, AlertTriangleIcon, AlertCircleIcon, DollarIcon, ShieldIcon, CheckIcon, XIcon, ClockIcon } from "../components/icons.jsx";

export function DashboardView() {
  const [traces, setTraces] = useState({ count: "-", breakdown: "Loading..." });
  const [risk, setRisk] = useState({ crit: "-", subBreakdown: "" });
  const [cost, setCost] = useState({ total: "-", bars: [] });
  const [approvals, setApprovals] = useState({ count: "-", hint: "Loading..." });
  const [governance, setGovernance] = useState(null);

  const load = async () => {
    const results = await Promise.allSettled([
      loadTraces(),
      loadRisk(),
      loadCost(),
      loadApprovals(),
      loadGovernance(),
    ]);
    return results.every((r) => r.status === "fulfilled");
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
      const subBreakdown = [`High ${l.high ?? 0}`, `Med ${l.medium ?? 0}`, `Low ${l.low ?? 0}`].join(" · ");
      setRisk({ crit: l.critical ?? 0, subBreakdown });
    } catch {
      setRisk({ crit: "-", subBreakdown: "" });
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

  async function loadGovernance() {
    try {
      const data = await api(`/ops/api/dashboards/governance?${buildParams()}`);
      setGovernance(data.dashboard);
    } catch {
      setGovernance(null);
      throw new Error("governance");
    }
  }

  return (
    <section class="dashboard-view">
      <Hero />
      <div class="dashboard-grid dashboard-grid--primary">
        <StatCard icon={<ActivityIcon />} variant="info" label="Traces Today" tooltip={copy.tooltips.dashboard.tracesToday} value={traces.count} meta={traces.breakdown} href={`#traces?start_date=${new Date().toISOString().split("T")[0]}`} />
        <StatCard
          icon={<ShieldIcon />}
          variant="warn"
          label="Critical Risk"
          tooltip={copy.tooltips.dashboard.criticalRisk}
          value={risk.crit}
          meta={risk.subBreakdown}
          href="#traces?risk_level=critical"
        />
        <StatCard icon={<DollarIcon />} variant="success" label="Cost (7d)" tooltip={copy.tooltips.dashboard.cost7d} value={cost.total} href="#cost?range=7d">
          {cost.bars.length > 0 && (
            <div class="spark-bars">
              {cost.bars.map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}
            </div>
          )}
        </StatCard>
        <StatCard icon={<ClockIcon />} variant="primary" label="Pending" tooltip={copy.tooltips.dashboard.pendingDecisions} value={approvals.count} meta={approvals.hint} href="#approvals" />
      </div>

      <div class="dashboard-governance-section">
        <div class="dashboard-governance-grid">
          <StatCard
            icon={<CheckIcon />}
            variant="success"
            label="Approved"
            tooltip={copy.tooltips.dashboard.approved}
            value={governance != null ? `${governance.approval_rate ?? 0}%` : "-"}
            meta={governance != null ? `${governance.allow_count ?? 0} in sample` : "—"}
            href="#traces?governance_decision=allow"
          />
          <StatCard
            icon={<XIcon />}
            variant="warn"
            label="Denied"
            tooltip={copy.tooltips.dashboard.denied}
            value={governance != null ? `${governance.denial_rate ?? 0}%` : "-"}
            meta={governance != null ? `${governance.deny_count ?? 0} in sample` : "—"}
            href="#traces?governance_decision=deny"
          />
          <StatCard
            icon={<AlertTriangleIcon />}
            variant="warn"
            label="Adapter Errors"
            tooltip={copy.tooltips.dashboard.adapterErrors}
            value={governance != null ? (governance.adapter_error_count ?? 0) : "-"}
            meta={governance != null ? `of ${governance.trace_sample_size ?? 0} traces` : "—"}
            href="#traces?status=error"
          />
          <StatCard
            icon={<AlertCircleIcon />}
            variant="warn"
            label="Incidents"
            tooltip={copy.tooltips.dashboard.incidents}
            value={governance != null ? (governance.incident_count ?? 0) : "-"}
            meta={governance != null ? "denied or error" : "—"}
            href="#incidents"
          />
        </div>
      </div>
    </section>
  );
}
