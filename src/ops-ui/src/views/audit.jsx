import { useEffect, useState } from "preact/hooks";
import { tenantId, selectedWorkspace, showToast } from "../state.js";
import { api, buildParams } from "../api.js";
import { StatCard } from "../components/stat-card.jsx";
import { ShieldIcon, LockIcon, SearchIcon, ActivityIcon, RefreshIcon } from "../components/icons.jsx";

export function AuditView() {
  const [entries, setEntries] = useState(null);
  const [eventType, setEventType] = useState("");
  const [startDate, setStartDate] = useState("");

  const load = async () => {
    try {
      const params = buildParams({ limit: 50 });
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

  const handleRefresh = async () => {
    const ok = await load();
    showToast(ok ? "Audit log refreshed" : "Failed to load audit log", ok ? "success" : "error");
  };

  useEffect(() => { load(); }, [tenantId.value, selectedWorkspace.value]);


  const getBadgeVariant = (type) => {
    if (type.includes("violation") || type.includes("deny")) return "badge-pill warn";
    if (type.includes("create") || type.includes("approve")) return "badge-pill success";
    return "badge-pill";
  };

  return (
    <div class="content-container">
      <div class="flex justify-between items-end mb-4">
        <div>
          <h2 data-tooltip="Local, self-attested record of system events and governance decisions">Audit Log</h2>
          <div class="text-secondary text-xs" style={{ marginTop: 4 }}>Local audit history (self-attested)</div>
        </div>
        <button class="btn-secondary btn-sm" data-tooltip="Reload audit events from the server" onClick={handleRefresh}><RefreshIcon width={14} /> Refresh</button>
      </div>

      <div class="dashboard-grid">
        <StatCard 
          icon={<FileIcon />} 
          variant="primary" 
          label="Total Events" 
          value={entries ? entries.length : "-"} 
          meta="In current view" 
          tooltip="Total number of audit events returned by the current query"
        />
        <StatCard
          icon={<ShieldIcon />}
          variant="info"
          label="Trust Status"
          value="Self-attested"
          meta="Local evidence only"
          tooltip="Clasper Core produces self-attested logs only (no external proof)"
        />
        <StatCard
          icon={<LockIcon />}
          variant="info"
          label="Retention"
          value="Local"
          meta="Configurable"
          tooltip="Local retention settings apply to audit records"
        />
      </div>

      <div class="grid-layout">
        <div class="panel">
          <div class="panel-header">
            <h3 data-tooltip="Chronological log of all recorded events — filter by type or date to narrow results">Event History</h3>
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
                <button class="btn-primary btn-sm" data-tooltip="Search audit events with the current filters" onClick={load}><SearchIcon width={14} /></button>
              </div>
            </div>
          </div>
          
          <div class="table-container" style={{ minHeight: "400px" }}>
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
                      <td class="mono text-secondary">{new Date(e.timestamp).toLocaleString()}</td>
                      <td><span class={getBadgeVariant(e.event_type)}>{e.event_type}</span></td>
                      <td>
                        <div class="flex items-center gap-2">
                          <div class="user-avatar" style={{ width: 20, height: 20, fontSize: 10 }}>{e.actor[0].toUpperCase()}</div>
                          {e.actor}
                        </div>
                      </td>
                      <td class="mono text-xs">{e.target_id || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div class="flex gap-3" style={{ flexDirection: "column" }}>
          <div class="panel">
            <div class="panel-header">
              <h3 data-tooltip="Active tool-use authorizations granted to agents in this tenant">Tool Authorizations</h3>
              <button class="btn-ghost btn-sm p-0" data-tooltip="View all historical tool authorizations">View All</button>
            </div>
            <div class="list-group">
              <div class="empty-state" style={{ padding: "32px 16px" }}>
                <div class="text-xs text-secondary">No active authorizations.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
