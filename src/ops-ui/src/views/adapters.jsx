import { useEffect, useState } from "preact/hooks";
import { tenantId, selectedWorkspace, showToast } from "../state.js";
import { api, buildParams } from "../api.js";

export function AdaptersView() {
  const [adapters, setAdapters] = useState(null);

  const load = async () => {
    try {
      const data = await api(`/ops/api/adapters?${buildParams()}`);
      setAdapters(data.adapters || []);
      return true;
    } catch {
      setAdapters([]);
      return false;
    }
  };

  const handleRefresh = async () => {
    const ok = await load();
    showToast(ok ? "Adapters refreshed" : "Failed to load adapters", ok ? "success" : "error");
  };

  useEffect(() => { load(); }, [tenantId.value, selectedWorkspace.value]);

  return (
    <section>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-header"><h3 data-tooltip="External adapters registered with this control plane">Registered Adapters</h3><button class="btn-secondary btn-sm" data-tooltip="Reload the adapter list" onClick={handleRefresh}>Refresh</button></div>
          <div class="card-list">
            {adapters === null && <div class="empty-state"><div class="spinner" /></div>}
            {adapters && !adapters.length && <div class="empty-state">No adapters found.</div>}
            {adapters && adapters.map((a) => (
              <div key={a.adapter_id || a.display_name} class="stat-card">
                <div class="stat-content">
                  <div class="stat-label">Adapter</div>
                  <div class="stat-value" style={{ fontSize: "16px" }}>{a.display_name}</div>
                  <div class="stat-meta">v{a.version} · {a.risk_class}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><h3>Key Management</h3></div>
          <div class="panel-body">
            <p class="text-secondary text-sm">
              Adapter signing keys and external proof are Cloud-only. Clasper Core records self-attested telemetry only.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
