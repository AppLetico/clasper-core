import { useEffect, useState } from "preact/hooks";
import { tenantId, selectedWorkspace, showToast } from "../state.js";
import { api, buildParams } from "../api.js";
import { RefreshIcon } from "../components/icons.jsx";

const AGENT_INVENTORY_TOOLTIP =
  "Agents are derived from traces with agent_id or agent_role labels. Each entry represents a distinct agent identity or role seen in execution. Use this inventory to review which agents are active and link to their traces.";

export function AgentsView() {
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api(`/ops/api/agents?${buildParams()}`);
      setAgents(data.agents || []);
      return true;
    } catch (e) {
      console.error("Load agents error:", e);
      setAgents([]);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    const ok = await load();
    showToast(ok ? "Agents refreshed" : "Refresh failed", ok ? "success" : "error");
  };

  useEffect(() => { load(); }, [tenantId.value, selectedWorkspace.value]);

  return (
    <section class="agents-view">
      <div class="panel">
        <div class="panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 data-tooltip={AGENT_INVENTORY_TOOLTIP}>Agent Inventory</h3>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div class="text-secondary text-xs">{agents.length} agents</div>
            <button class="btn-secondary btn-sm" onClick={handleRefresh}>
              <RefreshIcon width={14} /> Refresh
            </button>
          </div>
        </div>

        <div class="table-container">
            {loading && <div class="empty-state"><div class="spinner" /></div>}
            {!loading && !agents.length && (
              <div class="empty-state">No agents found. Agents are derived from traces with agent_id or agent_role labels.</div>
            )}
            {!loading && agents.length > 0 && (
            <table class="data-table">
              <thead>
                <tr>
                  <th>Agent ID</th>
                  <th>Role</th>
                  <th class="text-right">Trace Count</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.agent_id}>
                    <td class="mono">{a.agent_id}</td>
                    <td>{a.agent_role || "-"}</td>
                    <td class="text-right">{a.trace_count}</td>
                    <td>
                      <a
                        href={a.agent_id.startsWith("role:")
                          ? `#traces?agent_role=${encodeURIComponent(a.agent_id.slice(5))}`
                          : `#traces?agent_id=${encodeURIComponent(a.agent_id)}`}
                        class="btn-secondary btn-sm"
                      >
                        View traces
                      </a>
                    </td>
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
