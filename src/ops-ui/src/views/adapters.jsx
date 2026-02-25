import { useEffect, useState } from "preact/hooks";
import { tenantId, selectedWorkspace, showToast } from "../state.js";
import { api, buildParams } from "../api.js";
import { XIcon, RefreshIcon } from "../components/icons.jsx";
import { RISK_KIND, RISK_LABEL, titleCase } from "../labelColors.js";

const REGISTERED_ADAPTERS_TOOLTIP =
  "Adapters are external runtimes that execute actions and report telemetry (traces, decisions, cost) to this control plane. Adapters register automatically when they connect. The list below shows all adapters currently known to Clasper Core. Telemetry recorded by Clasper Core is self-attested. Trusted adapter identities, signing keys, and externally verifiable proof are provided by Clasper Cloud.";

export function AdaptersView() {
  const [adapters, setAdapters] = useState(null);
  const [selectedAdapter, setSelectedAdapter] = useState(null);

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

  const openDrawer = (a) => setSelectedAdapter(a);
  const closeDrawer = () => setSelectedAdapter(null);

  return (
    <section>
      <div class="panel">
        <div class="panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 data-tooltip={REGISTERED_ADAPTERS_TOOLTIP}>Registered Adapters</h3>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <span class="text-secondary text-xs">{adapters ? adapters.length : 0} adapters</span>
            <button class="btn-secondary btn-sm" data-tooltip="Reload the adapter list" onClick={handleRefresh}>
              <RefreshIcon width={14} /> Refresh
            </button>
          </div>
        </div>

        <div class="panel-body p-0">
          <div class="list-group">
            {adapters === null && <div class="empty-state"><div class="spinner" /></div>}
            {adapters && !adapters.length && <div class="empty-state">No adapters found.</div>}
            {adapters && adapters.map((a) => (
              <div
                key={`${a.adapter_id}-${a.version}`}
                class="detail-block card-item"
                style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}
                onClick={() => openDrawer(a)}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
                    <strong style={{ fontSize: "14px", color: "var(--text-primary)" }}>{a.display_name}</strong>
                    <span class={`badge-pill ${RISK_KIND[a.risk_class] || "muted"}`}>{RISK_LABEL[a.risk_class] ?? titleCase(a.risk_class)}</span>
                  </div>
                  <div class="text-secondary text-xs">
                    {a.adapter_id} · v{a.version}
                    {a.capabilities && a.capabilities.length > 0 && (
                      <span style={{ marginLeft: "8px", opacity: 0.8 }}>· {a.capabilities.length} capabilities</span>
                    )}
                  </div>
                </div>
                <div style={{ color: "var(--text-tertiary)" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Adapter detail drawer */}
      <div class={`drawer ${selectedAdapter ? "open" : ""}`}>
        <div class="drawer-header">
          <h3>Adapter details</h3>
          <button class="btn-icon" onClick={closeDrawer}><XIcon /></button>
        </div>
        <div class="drawer-body">
          {selectedAdapter && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div class="detail-block" style={{ padding: "12px 16px", marginBottom: 0 }}>
                <div class="detail-row">
                  <span class="detail-label">Display name</span>
                  <span class="mono">{selectedAdapter.display_name}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Adapter ID</span>
                  <span class="mono">{selectedAdapter.adapter_id}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Version</span>
                  <span class="mono">v{selectedAdapter.version}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Risk class</span>
                  <span class={`badge-pill ${RISK_KIND[selectedAdapter.risk_class] || "muted"}`}>
                    {RISK_LABEL[selectedAdapter.risk_class] ?? titleCase(selectedAdapter.risk_class)}
                  </span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Enabled</span>
                  <span>{selectedAdapter.enabled ? "Yes" : "No"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Tenant</span>
                  <span class="mono">{selectedAdapter.tenant_id}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Registered</span>
                  <span>{selectedAdapter.created_at || "—"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Last updated</span>
                  <span>{selectedAdapter.updated_at || "—"}</span>
                </div>
              </div>

              <div class="drawer-section-header" style={{ marginTop: "4px", marginBottom: "6px" }}>Plugin runtime</div>
              <div class="detail-block" style={{ padding: "10px 16px", marginBottom: 0 }}>
                <div class="detail-row">
                  <span class="detail-label">Integration</span>
                  <span class="mono">
                    {selectedAdapter.adapter_id?.startsWith("openclaw") ? "clasper-openclaw" : "adapter-managed"}
                  </span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Reported version</span>
                  <span class="mono">v{selectedAdapter.version}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Runtime</span>
                  <span>{selectedAdapter.display_name || "External adapter runtime"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Source</span>
                  <span class="text-secondary text-xs">
                    Self-reported by adapter registration
                  </span>
                </div>
              </div>

              {selectedAdapter.capabilities && selectedAdapter.capabilities.length > 0 && (
                <>
                  <div class="drawer-section-header" style={{ marginTop: "4px", marginBottom: "6px" }}>Capabilities</div>
                  <div class="detail-block" style={{ padding: "10px 16px", marginBottom: 0 }}>
                    <ul style={{ margin: 0, paddingLeft: "20px", color: "var(--text-primary)", fontSize: "13px", lineHeight: 1.6 }}>
                      {selectedAdapter.capabilities.map((cap, i) => (
                        <li key={i} class="mono">{cap}</li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div
        class="drawer-backdrop"
        onClick={closeDrawer}
        style={selectedAdapter ? { opacity: 1, pointerEvents: "auto" } : {}}
      />
    </section>
  );
}
