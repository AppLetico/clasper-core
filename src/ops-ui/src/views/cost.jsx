import { useEffect, useMemo, useState } from "preact/hooks";
import { tenantId, selectedWorkspace, routeQuery, formatCost, showToast } from "../state.js";
import { api, buildParams } from "../api.js";
import { RefreshIcon, HelpCircleIcon } from "../components/icons.jsx";
import { copy } from "../copy.js";

function parseRange(q) {
  const params = new URLSearchParams(q || "");
  const range = params.get("range");
  return range === "30d" ? "30d" : "7d";
}

function toTracesForDay(day) {
  location.hash = `#traces?start_date=${day}&end_date=${day}`;
}

export function CostView() {
  const [loading, setLoading] = useState(true);
  const [daily, setDaily] = useState([]);
  const [range, setRange] = useState(parseRange(routeQuery.value));
  const [showHelp, setShowHelp] = useState(false);

  // Apply hash query (#cost?range=7d|30d) and then normalize URL to #cost
  useEffect(() => {
    const q = routeQuery.value;
    if (!q) return;
    setRange(parseRange(q));
    routeQuery.value = "";
    if (location.hash.includes("?")) location.hash = "cost";
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api(`/ops/api/dashboards/cost?${buildParams()}`);
      const rows = data.dashboard?.daily || [];
      setDaily(rows);
      return true;
    } catch (e) {
      console.error("Load cost dashboard error:", e);
      setDaily([]);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    const ok = await load();
    showToast(ok ? copy.toasts.costRefreshSuccess : copy.toasts.costRefreshError, ok ? "success" : "error");
  };

  useEffect(() => { load(); }, [tenantId.value, selectedWorkspace.value]);

  const rangeDays = range === "30d" ? 30 : 7;

  const dailyForRange = useMemo(() => {
    // API returns DESC; clamp to range and reverse to ASC for charts.
    const desc = (daily || []).slice(0, rangeDays);
    return desc.slice().reverse();
  }, [daily, rangeDays]);

  const total = useMemo(() => {
    return dailyForRange.reduce((sum, d) => sum + (Number(d.total_cost) || 0), 0);
  }, [dailyForRange]);

  const max = useMemo(() => {
    return Math.max(...dailyForRange.map((d) => Number(d.total_cost) || 0), 0.0001);
  }, [dailyForRange]);

  // Y-axis ticks: 0 and 2–3 steps up to max
  const yTicks = useMemo(() => {
    if (max <= 0) return [{ value: 0, label: formatCost(0) }];
    const step = max / 2;
    return [
      { value: 0, label: formatCost(0) },
      { value: step, label: formatCost(step) },
      { value: max, label: formatCost(max) },
    ];
  }, [max]);

  const formatDay = (dayStr) => {
    if (!dayStr) return "";
    const [y, m, d] = dayStr.split("-");
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <section>
      <div class="panel">
        <div class="panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 data-tooltip="Model usage cost for governed executions">Model Usage</h3>
            <button 
              class="btn-icon" 
              onClick={() => setShowHelp(!showHelp)} 
              title="Toggle help"
              style={{ color: showHelp ? "var(--text-primary)" : "var(--text-secondary)" }}
            >
              <HelpCircleIcon width={20} strokeWidth={3} />
            </button>
          </div>
          <div class="toolbar-group">
            <div class="theme-segments" data-tooltip={copy.tooltips.cost.rangeToggle}>
              <button
                class={`theme-tab ${range === "7d" ? "active" : ""}`}
                onClick={() => setRange("7d")}
              >
                7d
              </button>
              <button
                class={`theme-tab ${range === "30d" ? "active" : ""}`}
                onClick={() => setRange("30d")}
              >
                30d
              </button>
            </div>
            <button class="btn-icon" onClick={handleRefresh} title="Refresh" data-tooltip={copy.tooltips.cost.refresh}>
              <RefreshIcon />
            </button>
          </div>
        </div>

        {showHelp && (
          <div style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-subtle)" }}>
            <p class="text-secondary text-sm" style={{ lineHeight: "1.5", margin: 0 }}>
              Model usage cost for governed executions. Click a bar to view traces for that day.
            </p>
          </div>
        )}

        <div class="panel-summary">
          <div class="text-secondary text-xs">{copy.cost.totalLabel(range)}</div>
          <div style={{ fontSize: "28px", fontWeight: 800, marginTop: 2 }}>{formatCost(total)}</div>
          <div class="text-secondary text-xs" style={{ marginTop: 6 }}>
            {copy.cost.excludesNote}
          </div>
        </div>

        <div class="panel-body">
          <div class="detail-row" style={{ marginBottom: 10 }}>
            <span class="detail-label">Daily cost</span>
            <span class="text-secondary text-xs" data-tooltip={copy.tooltips.cost.chartHint}>
              {copy.cost.chartHint}
            </span>
          </div>

          {loading && <div class="empty-state loading"><div class="spinner" /><div>Loading cost…</div></div>}
          {!loading && !dailyForRange.length && <div class="empty-state">No cost data for this range</div>}
          {!loading && dailyForRange.length > 0 && (
            <div class="cost-chart-wrap">
              <div class="cost-y-axis" aria-hidden="true">
                {yTicks.slice().reverse().map((t) => (
                  <div key={t.value} class="cost-y-tick">{t.label}</div>
                ))}
              </div>
              
              <div class="cost-chart-area">
                {/* Grid Lines */}
                <div class="cost-grid-lines" aria-hidden="true">
                  {yTicks.map((t) => (
                    <div 
                      key={t.value} 
                      class="cost-grid-line" 
                      style={{ bottom: max > 0 ? `${(t.value / max) * 100}%` : '0%' }} 
                    />
                  ))}
                </div>

                {/* Bars */}
                <div class="cost-bars" role="list">
                  {dailyForRange.map((d) => {
                    const v = Number(d.total_cost) || 0;
                    const h = max > 0 ? Math.max(4, (v / max) * 100) : 0;
                    return (
                      <button
                        key={d.day}
                        class="cost-bar-column"
                        role="listitem"
                        onClick={() => toTracesForDay(d.day)}
                        data-tooltip={`${d.day} · ${formatCost(v)} · ${d.trace_count || 0} traces`}
                        title=""
                      >
                        <span class="cost-bar-value">{formatCost(v)}</span>
                        <div class="cost-bar-track">
                          <div class="cost-bar" style={{ height: `${h}%` }} />
                        </div>
                        <span class="cost-bar-date">{formatDay(d.day)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

