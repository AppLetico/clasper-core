import { useEffect, useState } from "preact/hooks";
import { tenantId, selectedWorkspace, showToast } from "../state.js";
import { api, buildParams } from "../api.js";
import { HelpCircleIcon, SearchIcon, ActivityIcon, RefreshIcon } from "../components/icons.jsx";

export function AuditView() {
  const [entries, setEntries] = useState(null);
  const [eventType, setEventType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [page, setPage] = useState({ limit: 50, offset: 0 });
  const [showHelp, setShowHelp] = useState(false);
  
  const getEntryTimestamp = (e) => e?.created_at || e?.createdAt || e?.timestamp || e?.created || null;
  const getEntryActor = (e) =>
    e?.user_id ||
    e?.actor ||
    e?.event_data?.actor ||
    e?.event_data?.user_id ||
    e?.event_data?.requested_by ||
    e?.event_data?.approved_by ||
    "";
  const getEntryTargetId = (e) =>
    e?.target_id ||
    e?.trace_id ||
    e?.traceId ||
    e?.event_data?.trace_id ||
    e?.event_data?.execution_id ||
    e?.event_data?.policy_id ||
    e?.event_data?.skill_id ||
    e?.event_data?.adapter_id ||
    "";

  const load = async () => {
    try {
      const params = buildParams({ limit: page.limit, offset: page.offset });
      if (eventType) params.set("event_type", eventType);
      if (startDate) params.set("start_date", startDate);
      const data = await api(`/ops/api/audit?${params}`);
      setEntries(data.entries || []);
      return true;
    } catch {
      setEntries([]);
      return false;
    }
  };

  const search = () => { setPage((p) => ({ ...p, offset: 0 })); load(); };

  const handleRefresh = async () => {
    const ok = await load();
    showToast(ok ? "Audit log refreshed" : "Failed to load audit log", ok ? "success" : "error");
  };
  
  useEffect(() => { load(); }, [tenantId.value, selectedWorkspace.value, page.offset, page.limit]);

  const pageNum = Math.floor(page.offset / page.limit) + 1;

  const getBadgeVariant = (type = "") => {
    if (type.includes("violation") || type.includes("deny")) return "badge-pill warn";
    if (type.includes("create") || type.includes("approve")) return "badge-pill success";
    return "badge-pill";
  };

  return (
    <section>
      <div class="panel full-height">
        <div class="panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 data-tooltip="Records governance decisions, execution events, and system activity observed by Clasper Core.">Audit Log</h3>
            <button 
              class="btn-icon" 
              onClick={() => setShowHelp(!showHelp)} 
              title="Toggle help"
              style={{ color: showHelp ? "var(--text-primary)" : "var(--text-secondary)" }}
            >
              <HelpCircleIcon width={20} strokeWidth={3} />
            </button>
          </div>
          <button class="btn-secondary btn-sm" data-tooltip="Reload audit events" onClick={handleRefresh}>
            <RefreshIcon width={14} /> Refresh
          </button>
        </div>

        {showHelp && (
          <div style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-subtle)" }}>
            <p class="text-secondary text-sm" style={{ lineHeight: "1.5", margin: 0 }}>
              The audit log records governance decisions, execution events, and system activity observed by Clasper Core.
            </p>
            <p class="text-secondary text-sm" style={{ lineHeight: "1.5", margin: "8px 0 0 0" }}>
              These records are self-attested and intended for local inspection, debugging, and internal review.
            </p>
            <p class="text-secondary text-sm" style={{ lineHeight: "1.5", margin: "8px 0 0 0" }}>
              Externally verifiable audit records, signed evidence, and long-term retention are provided by Clasper Cloud.
            </p>
          </div>
        )}

        <div class="toolbar">
          <div class="toolbar-group">
            <div class="input-group">
              <input 
                class="input-sm" 
                placeholder="Filter by Event Type..." 
                value={eventType} 
                onInput={(e) => setEventType(e.target.value)} 
                data-tooltip="Filter events by type (e.g. trace.created, policy.violation)"
              />
              <input 
                type="date" 
                class="input-sm" 
                value={startDate} 
                onInput={(e) => setStartDate(e.target.value)} 
                data-tooltip="Show only events from this date onwards"
              />
              <button class="btn-primary btn-sm" data-tooltip="Search audit events with the current filters" onClick={search}><SearchIcon width={14} /></button>
            </div>
          </div>
        </div>
          
        <div class="table-container">
          {entries === null && <div class="empty-state"><div class="spinner" /></div>}
          {entries && !entries.length && (
            <div class="empty-state">
              <ActivityIcon class="empty-icon" />
              <div>No audit events found matching your criteria.</div>
            </div>
          )}
          {entries && entries.length > 0 && (
            <table class="data-table">
              <thead><tr>
                <th data-tooltip="When the event was recorded (local time)">Time</th>
                <th data-tooltip="Category of the audit event (e.g. trace.created, policy.deny)">Event Type</th>
                <th data-tooltip="User or system identity that triggered the event">Actor</th>
                <th data-tooltip="The resource ID affected by this event (trace, policy, skill, etc.)">Target Resource</th>
              </tr></thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i}>
                    <td class="mono text-secondary">
                      {(() => {
                        const ts = getEntryTimestamp(e);
                        if (!ts) return "-";
                        const d = new Date(ts);
                        return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
                      })()}
                    </td>
                    <td><span class={getBadgeVariant(e.event_type)}>{e.event_type || "-"}</span></td>
                    <td>
                      <div class="flex items-center gap-2">
                        <div class="user-avatar" style={{ width: 20, height: 20, fontSize: 10 }}>
                          {(((getEntryActor(e) || "?")[0]) || "?").toUpperCase()}
                        </div>
                        {getEntryActor(e) || "-"}
                      </div>
                    </td>
                    <td class="mono text-xs">{getEntryTargetId(e) || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
