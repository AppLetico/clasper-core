import { useEffect, useMemo, useState } from "preact/hooks";
import { tenantId, selectedWorkspace, routeQuery, formatCost, showToast } from "../state.js";
import { api, buildParams } from "../api.js";
import { RefreshIcon } from "../components/icons.jsx";
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

  return (
    <section>
      <div class="panel">
        <div class="toolbar">
          <div class="toolbar-group">
            <div>
              <div style={{ fontWeight: 700, fontSize: "16px" }}>Cost</div>
              <div class="text-secondary text-xs" style={{ marginTop: 4 }}>
                {copy.cost.subtitle}
              </div>
            </div>
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

        <div class="panel-summary">
          <div class="text-secondary text-xs">{copy.cost.totalLabel(range)}</div>
          <div style={{ fontSize: "28px", fontWeight: 800, marginTop: 2 }}>{formatCost(total)}</div>
          <div class="text-secondary text-xs" style={{ marginTop: 6 }}>
            {copy.cost.excludesNote}
          </div>
        </div>

        <div class="panel-body">
          {/* Chart */}
          <div style={{ marginBottom: 24 }}>
            <div class="detail-row" style={{ marginBottom: 10 }}>
              <span class="detail-label">Daily total</span>
              <span class="text-secondary text-xs" data-tooltip={copy.tooltips.cost.chartHint}>
                {copy.cost.chartHint}
              </span>
            </div>

            {loading && <div class="empty-state loading"><div class="spinner" /><div>Loading cost…</div></div>}
            {!loading && !dailyForRange.length && <div class="empty-state">No cost data for this range</div>}
            {!loading && dailyForRange.length > 0 && (
              <div class="cost-bars" role="list">
                {dailyForRange.map((d) => {
                  const v = Number(d.total_cost) || 0;
                  const h = Math.max(6, (v / max) * 100);
                  return (
                    <button
                      key={d.day}
                      class="cost-bar"
                      role="listitem"
                      onClick={() => toTracesForDay(d.day)}
                      data-tooltip={`${d.day} · ${formatCost(v)} · ${d.trace_count || 0} traces`}
                      title=""
                      style={{ height: `${h}%` }}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Daily list */}
          <div>
            <div class="detail-row" style={{ marginBottom: 10 }}>
              <span class="detail-label">Daily breakdown</span>
              <span class="text-secondary text-xs">Click a day to view traces</span>
            </div>

            {loading && <div class="empty-state loading"><div class="spinner" /><div>Loading…</div></div>}
            {!loading && !dailyForRange.length && <div class="text-secondary text-xs">—</div>}
            {!loading && dailyForRange.map((d) => (
              <button
                key={d.day}
                class="cost-row"
                onClick={() => toTracesForDay(d.day)}
                data-tooltip={copy.tooltips.cost.dayRow}
              >
                <span class="mono">{d.day}</span>
                <span class="mono">{formatCost(Number(d.total_cost) || 0)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

