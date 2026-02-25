import { useEffect, useState } from "preact/hooks";
import { tenantId, selectedWorkspace, showToast } from "../state.js";
import { api, buildParams } from "../api.js";
import { SearchIcon, ActivityIcon, RefreshIcon, XIcon } from "../components/icons.jsx";

const AUDIT_LOG_TOOLTIP =
  "The audit log records governance decisions, execution events, and system activity observed by Clasper Core. These records are self-attested and intended for local inspection, debugging, and internal review. Externally verifiable audit records, signed evidence, and long-term retention are provided by Clasper Cloud.";

function getTargetPaths(context) {
  const targets = context?.targets;
  if (Array.isArray(targets)) return targets.filter((v) => typeof v === "string");
  if (targets && Array.isArray(targets.paths)) return targets.paths.filter((v) => typeof v === "string");
  return [];
}

function formatConditionDetail(detail) {
  if (!detail) return null;
  if (detail.field === "context.exec.argv0" && detail.result && detail.operator === "in") {
    return `Allowed: argv0 matched allowlist (${String(detail.actual)})`;
  }
  if (
    detail.field === "context.targets.paths" &&
    !detail.result &&
    (detail.operator === "all_under" || detail.operator === "any_under")
  ) {
    const firstPath = Array.isArray(detail.actual) ? detail.actual[0] : null;
    return firstPath
      ? `Blocked: path \`${firstPath}\` outside allowed scope`
      : "Blocked: path outside allowed scope";
  }
  return `${detail.result ? "Matched" : "Failed"}: ${detail.field} (${detail.operator})`;
}

export function AuditView() {
  const [entries, setEntries] = useState(null);
  const [eventType, setEventType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [page, setPage] = useState({ limit: 50, offset: 0 });
  const [selectedEntry, setSelectedEntry] = useState(null);
  
  const getEntryTimestamp = (e) => e?.created_at || e?.createdAt || e?.timestamp || e?.created || null;
  const getEventData = (e) => (e?.event_data && typeof e.event_data === "object" ? e.event_data : {});
  const getEntryActor = (e) =>
    e?.user_id ||
    e?.actor ||
    getEventData(e)?.actor ||
    getEventData(e)?.user_id ||
    getEventData(e)?.requested_by ||
    getEventData(e)?.approved_by ||
    (getEventData(e)?.adapter_id ? `adapter:${getEventData(e).adapter_id}` : "system");
  const getEntryTargetId = (e) =>
    e?.target_id ||
    e?.trace_id ||
    e?.traceId ||
    getEventData(e)?.trace_id ||
    getEventData(e)?.execution_id ||
    getEventData(e)?.policy_id ||
    getEventData(e)?.skill_id ||
    getEventData(e)?.adapter_id ||
    "";
  const getEntryActionSummary = (e) =>
    e?.action_summary ||
    (() => {
      const eventType = e?.event_type || "";
      const ed = getEventData(e);
      const tool = typeof ed.tool === "string" ? ed.tool : null;
      if (eventType === "policy_decision_pending") {
        return `Approval requested${tool ? ` for ${tool}` : ""}`;
      }
      if (eventType === "policy_decision_resolved") {
        const status = typeof ed.status === "string" ? ed.status : "resolved";
        return `Approval ${status}${tool ? ` for ${tool}` : ""}`;
      }
      if (eventType === "adapter_audit_event") {
        return typeof ed.event_type === "string" ? `Adapter event: ${ed.event_type}` : "Adapter event";
      }
      if (eventType === "policy_exception_hit") {
        return `Policy exception matched${typeof ed.policy_id === "string" ? ` (${ed.policy_id})` : ""}`;
      }
      if (eventType === "policy_exception_miss") {
        return `Policy exception missed${typeof ed.policy_id === "string" ? ` (${ed.policy_id})` : ""}`;
      }
      if (eventType === "policy_created_via_wizard") {
        return `Policy created via wizard${typeof ed.policy_id === "string" ? ` (${ed.policy_id})` : ""}`;
      }
      if (eventType === "policy_updated_via_wizard") {
        return `Policy updated via wizard${typeof ed.policy_id === "string" ? ` (${ed.policy_id})` : ""}`;
      }
      if (eventType === "approval_grant_created") {
        return "Approval grant window opened";
      }
      if (eventType === "approval_grant_consumed") {
        return "Approval reused via grant window";
      }
      return eventType || "-";
    })();
  const getEntryTargetSummary = (e) => {
    if (e?.target_summary) return e.target_summary;
    const ed = getEventData(e);
    const targets = Array.isArray(ed.targets) ? ed.targets.filter((v) => typeof v === "string") : [];
    if (targets.length > 0) return targets.join(", ");
    return getEntryTargetId(e) || "-";
  };
  const getEntryRequestSummary = (e) => {
    const ed = getEventData(e);
    const originalRequest = e?.original_request && typeof e.original_request === "object" ? e.original_request : null;
    const tool =
      (typeof originalRequest?.tool === "string" && originalRequest.tool) ||
      (typeof ed.tool === "string" && ed.tool) ||
      null;
    const targetsFromOriginal = [
      ...(Array.isArray(originalRequest?.targets)
        ? originalRequest.targets.filter((v) => typeof v === "string")
        : []),
      ...getTargetPaths(originalRequest?.context),
    ];
    const targetsFromEvent = Array.isArray(ed.targets) ? ed.targets.filter((v) => typeof v === "string") : [];
    const targets = targetsFromOriginal.length > 0 ? targetsFromOriginal : targetsFromEvent;
    const intent =
      (typeof originalRequest?.intent === "string" && originalRequest.intent) ||
      (typeof ed.intent === "string" && ed.intent) ||
      null;

    if (!tool && !intent) {
      return {
        title: getEntryTargetSummary(e),
        subtitle: null,
      };
    }

    const title = tool
      ? `${tool}${targets.length > 0 ? ` on ${targets.slice(0, 2).join(", ")}${targets.length > 2 ? "..." : ""}` : ""}`
      : getEntryTargetSummary(e);
    const subtitle = intent ? `intent: ${intent}` : null;
    return { title, subtitle };
  };
  const openEntry = (entry) => setSelectedEntry(entry);
  const closeEntry = () => setSelectedEntry(null);

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
            <h3 data-tooltip={AUDIT_LOG_TOOLTIP}>Audit Log</h3>
          </div>
          <button class="btn-secondary btn-sm" data-tooltip="Reload audit events" onClick={handleRefresh}>
            <RefreshIcon width={14} /> Refresh
          </button>
        </div>

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
                <th data-tooltip="Human-readable action summary">What Happened</th>
                <th data-tooltip="User or system identity that triggered the event">Actor</th>
                <th data-tooltip="Original request context (tool, target, intent)">Request</th>
              </tr></thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i} onClick={() => openEntry(e)} style={{ cursor: "pointer" }}>
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
                      <div>{getEntryActionSummary(e)}</div>
                      {(() => {
                        const ed = getEventData(e);
                        if (!ed.intent) return null;
                        return <div class="text-secondary text-xs">intent: {String(ed.intent)}</div>;
                      })()}
                    </td>
                    <td>
                      <div class="flex items-center gap-2">
                        <div class="user-avatar" style={{ width: 20, height: 20, fontSize: 10 }}>
                          {(((getEntryActor(e) || "?")[0]) || "?").toUpperCase()}
                        </div>
                        {getEntryActor(e) || "-"}
                      </div>
                    </td>
                    <td>
                      {(() => {
                        const req = getEntryRequestSummary(e);
                        return (
                          <div>
                            <div class="mono text-xs">{req.title}</div>
                            {req.subtitle && <div class="text-secondary text-xs">{req.subtitle}</div>}
                          </div>
                        );
                      })()}
                    </td>
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
      <AuditEntryDrawer entry={selectedEntry} onClose={closeEntry} />
    </section>
  );
}

function AuditEntryDrawer({ entry, onClose }) {
  if (!entry) return <div class="drawer"><div class="drawer-backdrop" /></div>;
  const eventData = entry?.event_data && typeof entry.event_data === "object" ? entry.event_data : {};
  const originalRequest = entry?.original_request && typeof entry.original_request === "object" ? entry.original_request : null;
  const originalPolicy = entry?.original_policy && typeof entry.original_policy === "object" ? entry.original_policy : null;
  const executionId = eventData.execution_id || "-";
  const decisionId = eventData.decision_id || "-";
  const resourceId = entry.target_id || "-";

  const formatTime = (value) => {
    if (!value) return "-";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
  };
  const json = (value) => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };
  const wizardMeta =
    eventData?.wizard_meta && typeof eventData.wizard_meta === "object" && !Array.isArray(eventData.wizard_meta)
      ? eventData.wizard_meta
      : null;
  const policySummary =
    eventData?.policy_summary && typeof eventData.policy_summary === "object" && !Array.isArray(eventData.policy_summary)
      ? eventData.policy_summary
      : null;
  const policySummaryBefore =
    eventData?.policy_summary_before &&
    typeof eventData.policy_summary_before === "object" &&
    !Array.isArray(eventData.policy_summary_before)
      ? eventData.policy_summary_before
      : null;
  const policySummaryAfter =
    eventData?.policy_summary_after &&
    typeof eventData.policy_summary_after === "object" &&
    !Array.isArray(eventData.policy_summary_after)
      ? eventData.policy_summary_after
      : null;
  const wizardWarnings = Array.isArray(wizardMeta?.warnings_shown)
    ? wizardMeta.warnings_shown.filter((v) => typeof v === "string")
    : [];

  return (
    <>
      <div class={`drawer ${entry ? "open" : ""}`}>
        <div class="drawer-header">
          <h3>Audit Event Detail</h3>
          <button class="btn-icon" onClick={onClose}><XIcon /></button>
        </div>
        <div class="drawer-body">
          <div class="detail-block">
            <div class="detail-row">
              <span class="detail-label">Event Type</span>
              <span class="mono">{entry.event_type || "-"}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">What Happened</span>
              <span>{entry.action_summary || entry.event_type || "-"}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Actor</span>
              <span class="mono">{entry.actor || entry.user_id || "-"}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Time</span>
              <span>{formatTime(entry.created_at || entry.createdAt || entry.timestamp)}</span>
            </div>
          </div>

          <div class="drawer-section-header">Target</div>
          <div class="detail-block">
            <div class="detail-row">
              <span class="detail-label">Type</span>
              <span class="mono">{entry.target_type || "-"}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Summary</span>
              <span class="mono">{entry.target_summary || entry.target_id || "-"}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Resource ID</span>
              <span class="mono">{resourceId}</span>
            </div>
            {executionId !== "-" && executionId !== resourceId && (
              <div class="detail-row">
                <span class="detail-label">Execution ID</span>
                <span class="mono">{executionId}</span>
              </div>
            )}
            {decisionId !== "-" && decisionId !== resourceId && (
              <div class="detail-row">
                <span class="detail-label">Decision ID</span>
                <span class="mono">{decisionId}</span>
              </div>
            )}
            <div class="detail-row">
              <span class="detail-label">Adapter</span>
              <span class="mono">{eventData.adapter_id || "-"}</span>
            </div>
          </div>

          <div class="drawer-section-header">Event Data</div>
          <details open>
            <summary style={{ cursor: "pointer", fontSize: "12px", color: "var(--text-secondary)" }}>
              Show full JSON
            </summary>
            <pre class="mono" style={{ fontSize: "11px", marginTop: "8px", overflow: "auto", whiteSpace: "pre-wrap" }}>
              {json(eventData)}
            </pre>
          </details>

          {wizardMeta && (
            <>
              <div class="drawer-section-header">Wizard Provenance</div>
              <div class="detail-block">
                <div class="detail-row">
                  <span class="detail-label">Created via wizard</span>
                  <span>{wizardMeta.created_via_wizard ? "Yes" : "No"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Selected outcome</span>
                  <span class="mono">{wizardMeta.selected_outcome || "-"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Scope choice</span>
                  <span class="mono">{wizardMeta.scope_choice || "-"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Command match choice</span>
                  <span class="mono">{wizardMeta.command_match_choice || "-"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Allow acknowledged</span>
                  <span>{wizardMeta.wizard_acknowledged_allow ? "Yes" : "No"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Warnings shown</span>
                  <span class="mono">{wizardWarnings.join(", ") || "-"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Recorded by</span>
                  <span class="mono">{wizardMeta.attested_by || eventData.attested_by || "core"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Attestation hash</span>
                  <span class="mono">{eventData.wizard_meta_hash || "-"}</span>
                </div>
              </div>
            </>
          )}

          {policySummary && (
            <>
              <div class="drawer-section-header">Policy Summary (Attested)</div>
              <div class="detail-block">
                <div class="detail-row">
                  <span class="detail-label">Policy ID</span>
                  <span class="mono">{policySummary.policy_id || "-"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Effect</span>
                  <span class="mono">{policySummary.effect || "-"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Precedence</span>
                  <span class="mono">{policySummary.precedence ?? "-"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Scope</span>
                  <span class="mono">
                    tenant={policySummary?.scope?.tenant_id || "-"}, workspace={policySummary?.scope?.workspace_id || "-"}
                  </span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Key conditions</span>
                  <span class="mono">{json(policySummary.key_conditions || {})}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Recorded by</span>
                  <span class="mono">{eventData.attested_by || "core"}</span>
                </div>
              </div>
            </>
          )}

          {(policySummaryBefore || policySummaryAfter) && (
            <>
              <div class="drawer-section-header">Policy Update Summary (Attested)</div>
              <div class="detail-block">
                <div class="detail-row">
                  <span class="detail-label">Before</span>
                  <span class="mono">{json(policySummaryBefore || {})}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">After</span>
                  <span class="mono">{json(policySummaryAfter || {})}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Before hash</span>
                  <span class="mono">{eventData.policy_summary_before_hash || "-"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">After hash</span>
                  <span class="mono">{eventData.policy_summary_after_hash || "-"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Diff hint</span>
                  <span class="mono">
                    {Array.isArray(eventData.diff_hint) ? eventData.diff_hint.join(", ") || "-" : "-"}
                  </span>
                </div>
              </div>
            </>
          )}

          {originalRequest && (
            <>
              <div class="drawer-section-header">Original Request Reviewed</div>
              <div class="detail-block">
                <div class="detail-row">
                  <span class="detail-label">Tool</span>
                  <span class="mono">{originalRequest.tool || "-"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Group</span>
                  <span class="mono">{originalRequest.tool_group || "-"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Intent</span>
                  <span>{originalRequest.intent || "-"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Targets</span>
                  <span class="mono">
                    {[...(Array.isArray(originalRequest.targets) ? originalRequest.targets : []), ...getTargetPaths(originalRequest.context)].join(", ") || "-"}
                  </span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Capabilities</span>
                  <span class="mono">{(originalRequest.requested_capabilities || []).join(", ") || "-"}</span>
                </div>
              </div>
              <details>
                <summary style={{ cursor: "pointer", fontSize: "12px", color: "var(--text-secondary)" }}>
                  Show original request JSON
                </summary>
                <pre class="mono" style={{ fontSize: "11px", marginTop: "8px", overflow: "auto", whiteSpace: "pre-wrap" }}>
                  {json(originalRequest.raw || {})}
                </pre>
              </details>
            </>
          )}

          {originalPolicy && (
            <>
              <div class="drawer-section-header">Policy Summary</div>
              <div class="detail-block">
                <div class="detail-row">
                  <span class="detail-label">Decision</span>
                  <span class="mono">{originalPolicy.decision || "-"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Reason</span>
                  <span>{originalPolicy.blocked_reason || "-"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Matched Policies</span>
                  <span class="mono">{(originalPolicy.matched_policies || []).join(", ") || "-"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Explanation</span>
                  <span>{originalPolicy.explanation || "-"}</span>
                </div>
                {Array.isArray(originalPolicy.decision_trace) &&
                  originalPolicy.decision_trace.flatMap((entry) =>
                    Array.isArray(entry.condition_details) ? entry.condition_details : []
                  ).slice(0, 6).map((detail, idx) => (
                    <div class="detail-row" key={`cond-detail-${idx}`}>
                      <span class="detail-label">Condition</span>
                      <span>{formatConditionDetail(detail)}</span>
                    </div>
                  ))}
              </div>
              <details>
                <summary style={{ cursor: "pointer", fontSize: "12px", color: "var(--text-secondary)" }}>
                  Show policy decision JSON
                </summary>
                <pre class="mono" style={{ fontSize: "11px", marginTop: "8px", overflow: "auto", whiteSpace: "pre-wrap" }}>
                  {json(originalPolicy.raw || {})}
                </pre>
              </details>
            </>
          )}
        </div>
      </div>
      <div
        class="drawer-backdrop"
        onClick={onClose}
        style={entry ? { opacity: 1, pointerEvents: "auto" } : {}}
      />
    </>
  );
}
