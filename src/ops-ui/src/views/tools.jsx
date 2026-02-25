import { useState, useEffect } from "preact/hooks";
import { XIcon, ActivityIcon, ShieldIcon, RefreshIcon } from "../components/icons.jsx";
import { api } from "../api.js";

const TOOL_REGISTRY_TOOLTIP =
  "Tools are atomic execution capabilities (functions, APIs, or scripts) that agents must be explicitly authorized to use. Each tool represents a discrete authority boundary. Usage is governed by policy, evaluated per request, and recorded for audit and risk analysis. Unlike Skills, which bundle multiple capabilities, Tools are individual primitives. This registry shows all tools currently known and authorized within this workspace.";

function ToolDrawer({ tool, onClose }) {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tool) return;
    setLoading(true);
    // Reset history when tool changes
    setHistory(null);
    api(`/ops/api/tools/${tool.name}`)
      .then(d => setHistory(d.history || []))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [tool]);

  if (!tool) return null;

  const formatDate = (dateStr) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleString();
  };

  return (
    <>
      <div class={`drawer open`}>
        <div class="drawer-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
             <ShieldIcon width={18} />
             <h3>{tool.name}</h3>
          </div>
          <div class="drawer-actions">
            <button class="btn-icon" onClick={onClose}><XIcon /></button>
          </div>
        </div>
        <div class="drawer-body">
          <div class="detail-block">
            <div class="detail-row">
                <span class="detail-label">Total Uses</span>
                <span class="mono">{tool.auth_count}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Allow Rate</span>
                <span class="mono">
                  {tool.auth_count > 0 
                    ? Math.round((tool.allow_count / tool.auth_count) * 100) + "%" 
                    : "0%"}
                </span>
            </div>
             <div class="detail-row">
                <span class="detail-label">Allowed</span>
                <span class="badge-pill success">{tool.allow_count}</span>
            </div>
             <div class="detail-row">
                <span class="detail-label">Denied</span>
                <span class="badge-pill danger">{tool.deny_count}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Active Adapters</span>
                <span class="mono">{(tool.adapters || []).length}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Last Used</span>
                <span class="mono">{formatDate(tool.last_used)}</span>
            </div>
          </div>

          <div class="drawer-section-header">Recent Usage History</div>
          {loading ? (
            <div class="empty-state"><div class="spinner" /></div>
          ) : (history && history.length > 0) ? (
            <div class="steps">
              {history.map((h, i) => (
                <div key={i} class="step">
                  <div class="detail-row">
                    <span class={`badge-pill ${h.decision === 'allow' ? 'success' : 'danger'}`}>
                        {h.decision.toUpperCase()}
                    </span>
                    <span class="mono text-secondary" style={{ fontSize: "11px" }}>{formatDate(h.created_at)}</span>
                  </div>
                  <div class="detail-row" style={{ marginTop: "4px" }}>
                     <span class="text-secondary" style={{ fontSize: "12px" }}>Adapter</span>
                     <span class="mono" style={{ fontSize: "11px" }}>{h.adapter_id}</span>
                  </div>
                  {h.reason && (
                      <div class="text-secondary" style={{ fontSize: "12px", color: "var(--text-danger)", marginTop: "2px" }}>
                        Reason: {h.reason}
                      </div>
                  )}
                   <details style={{ marginTop: "6px" }}>
                    <summary class="text-secondary" style={{ fontSize: "11px", cursor: "pointer" }}>View scope</summary>
                    <pre class="mono" style={{ marginTop: "4px", whiteSpace: "pre-wrap", fontSize: "11px" }}>
                      {JSON.stringify(h.granted_scope, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          ) : (
             <div class="empty-state">No recent history found.</div>
          )}
        </div>
      </div>
      <div class="drawer-backdrop" onClick={onClose} style={{ opacity: 1, pointerEvents: "auto" }} />
    </>
  );
}

export function ToolsView() {
  const [tools, setTools] = useState(null);
  const [selectedTool, setSelectedTool] = useState(null);

  const load = async () => {
    try {
      const data = await api("/ops/api/tools/registry");
      setTools(data.tools || []);
    } catch {
      setTools([]);
    }
  };

  const handleRefresh = async () => {
    await load();
  };

  useEffect(() => {
    load();
  }, []);

  const count = Array.isArray(tools) ? tools.length : 0;

  return (
    <section>
      <div class="panel">
        <div class="panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 data-tooltip={TOOL_REGISTRY_TOOLTIP}>Tool Registry</h3>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div class="text-secondary text-xs">{count} tool{count !== 1 ? "s" : ""}</div>
            <button class="btn-secondary btn-sm" data-tooltip="Reload the tool list" onClick={handleRefresh}>
              <RefreshIcon width={14} /> Refresh
            </button>
          </div>
        </div>

        <div class="panel-body p-0">
          <div class="list-group">
            {count === 0 ? (
              <div class="empty-state" style={{ padding: "32px 16px" }}>
                <div class="text-xs text-secondary">No active tool authorizations.</div>
              </div>
            ) : (
              tools.map((t) => (
                <div
                  key={t.name}
                  class="detail-block card-item"
                  style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}
                  onClick={() => setSelectedTool(t)}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
                      <strong style={{ fontSize: "14px", color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{t.name}</strong>
                      <span class={`badge-pill ${t.deny_count > 0 ? "danger" : "success"}`} style={{ fontSize: "10px", padding: "2px 8px" }}>
                        {t.auth_count > 0 ? Math.round((t.allow_count / t.auth_count) * 100) + "% Allow" : "No Usage"}
                      </span>
                    </div>
                    <div class="text-secondary text-xs">
                      {t.auth_count} uses · {(t.adapters || []).length} adapters · Last used: {t.last_used ? new Date(t.last_used).toLocaleDateString() : "Never"}
                    </div>
                  </div>
                  <div style={{ color: "var(--text-tertiary)" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      
      {selectedTool && (
        <ToolDrawer 
            tool={selectedTool} 
            onClose={() => setSelectedTool(null)} 
        />
      )}
    </section>
  );
}
