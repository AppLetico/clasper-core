import fs from 'fs';
import path from 'path';
const file = path.join(process.cwd(), 'src/ops-ui/src/components/drawer.jsx');
let content = fs.readFileSync(file, 'utf8');

const oldStrStart = `function TraceDetailContent({ trace }) {`;
const oldStrEnd = `\nexport function openTrace(id) {`;

const startIndex = content.indexOf(oldStrStart);
const endIndex = content.indexOf(oldStrEnd);

if (startIndex === -1 || endIndex === -1) {
  console.log("Could not find start or end");
  process.exit(1);
}

const newContentStr = `function TraceDetailContent({ trace }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [simulateResult, setSimulateResult] = useState(null);
  const [simulateLoading, setSimulateLoading] = useState(false);
  const [replayResult, setReplayResult] = useState(null);
  const [replayLoading, setReplayLoading] = useState(false);

  const runSimulate = async () => {
    if (!trace?.id) return;
    setSimulateLoading(true);
    setSimulateResult(null);
    try {
      const params = buildParams();
      const res = await apiPost(\`/ops/api/traces/\${trace.id}/simulate?\${params}\`, {});
      setSimulateResult(res);
    } catch (e) {
      setSimulateResult({ error: e?.message || "Simulation failed" });
    } finally {
      setSimulateLoading(false);
    }
  };

  const runReplay = async () => {
    if (!trace?.id) return;
    setReplayLoading(true);
    setReplayResult(null);
    try {
      const params = buildParams();
      const res = await apiPost(\`/ops/api/traces/\${trace.id}/replay?\${params}\`, {});
      setReplayResult(res);
    } catch (e) {
      setReplayResult({ error: e?.message || "Replay failed" });
    } finally {
      setReplayLoading(false);
    }
  };

  const json = (v) => {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  };

  const stepTitle = (s) => {
    const d = s?.data || {};
    if (s.type === "tool_call") return \`\${d.toolName || "tool"} · \${d.permitted ? "permitted" : "denied"}\`;
    if (s.type === "tool_result") return \`\${d.toolName || "tool"} · \${d.success ? "success" : "error"}\`;
    if (s.type === "llm_call") return \`\${d.provider || "provider"}/\${d.model || "model"} · in \${d.inputTokens ?? "?"} · out \${d.outputTokens ?? "?"}\`;
    if (s.type === "error") return \`\${d.code || "error"}\`;
    return s.type;
  };

  const stepActionPreview = (s) => {
    if (s.type !== "tool_call") return null;
    const d = s?.data || {};
    const args = d.arguments || {};
    const tool = d.toolName || "";
    if (tool === "exec" || tool === "bash" || tool === "process") {
      const cmd = args.command ?? args.cmd ?? (Array.isArray(args.argv) ? args.argv.join(" ") : null);
      return cmd ? String(cmd) : null;
    }
    if (["read", "write", "edit", "delete", "apply_patch"].includes(tool)) {
      return args.path ?? args.file ?? args.target ?? null;
    }
    return null;
  };

  const gov = trace.governance || {};
  const scopeDelta = gov.scope_delta || {};
  const deniedTools = gov.denied_tools || [];
  const policyIds = gov.policy_ids || [];
  const requested = trace.requested_capabilities || trace.granted_scope?.capabilities || [];
  const displayAgent = trace.agent_role || (trace.adapter_id === "openclaw-local" ? "OpenClaw" : null) || "-";

  return (
    <>
      <div style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
          <div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
              <GovernanceBadge decision={gov.decision || "unknown"} />
              <ExecutionBadge status={trace.status} />
              {(gov.risk_score != null || gov.risk_level) && (
                <span class={\`badge-pill \${(gov.risk_level === 'high' || gov.risk_level === 'critical' || trace.risk?.level === 'high' || trace.risk?.level === 'critical') ? 'warn' : ''}\`}>
                  Risk: {gov.risk_score != null ? \`\${gov.risk_score}/100\` : (trace.risk?.score != null ? \`\${trace.risk?.score}/100\` : (gov.risk_level || trace.risk?.level))}
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span class="mono" style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)" }}>{trace.id}</span>
              <button
                type="button"
                class="btn-icon"
                title="Copy Trace ID"
                style={{ width: "24px", height: "24px", padding: "2px" }}
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await copyToClipboard(trace.id);
                    showToast("Trace ID copied", "success");
                  } catch {
                    showToast("Copy failed", "warn");
                  }
                }}
              >
                <CopyIcon style={{ width: "14px", height: "14px" }} />
              </button>
            </div>
          </div>
        </div>
        
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", fontSize: "13px", color: "var(--text-secondary)" }}>
          <div><strong style={{color: "var(--text-primary)", fontWeight: 500}}>Agent:</strong> {displayAgent}</div>
          {trace.adapter_id && <div><strong style={{color: "var(--text-primary)", fontWeight: 500}}>Adapter:</strong> {trace.adapter_id}</div>}
          <div><strong style={{color: "var(--text-primary)", fontWeight: 500}}>Cost:</strong> {formatCost(trace.cost)}</div>
          {trace.duration_ms != null && <div><strong style={{color: "var(--text-primary)", fontWeight: 500}}>Duration:</strong> {trace.duration_ms}ms</div>}
        </div>
      </div>

      <div class="theme-segments" style={{ marginBottom: "20px" }}>
        <button class={\`theme-tab \${activeTab === 'overview' ? 'active' : ''}\`} onClick={() => setActiveTab('overview')}>Overview</button>
        <button class={\`theme-tab \${activeTab === 'governance' ? 'active' : ''}\`} onClick={() => setActiveTab('governance')}>Governance</button>
        <button class={\`theme-tab \${activeTab === 'execution' ? 'active' : ''}\`} onClick={() => setActiveTab('execution')}>Execution</button>
        <button class={\`theme-tab \${activeTab === 'json' ? 'active' : ''}\`} onClick={() => setActiveTab('json')}>Raw JSON</button>
      </div>

      {activeTab === 'overview' && (
        <div class="tab-content animate-fade-in">
          {trace.status === "error" && (
            <div class="detail-block" style={{ borderLeft: "3px solid var(--accent-warn)", background: "var(--bg-subtle)", marginBottom: "16px" }}>
              <div class="drawer-section-header" style={{ marginTop: 0 }}>Why it failed</div>
              <p class="text-secondary" style={{ fontSize: "13px", margin: "0 0 8px 0" }}>
                {gov.decision === "allow" || gov.decision === "approved"
                  ? "Policy allowed this run, but the tool failed during execution."
                  : "This run did not complete successfully."}
              </p>
              {trace.error && <pre class="mono" style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "13px" }}>{trace.error}</pre>}
            </div>
          )}

          {(() => {
            const toolCallSteps = (trace.steps || []).filter((s) => s.type === "tool_call");
            const actionSummary = toolCallSteps.map((s) => {
              const d = s?.data || {};
              const args = d.arguments || {};
              const tool = d.toolName || "tool";
              if (tool === "exec" || tool === "bash" || tool === "process") {
                const cmd = args.command ?? args.cmd ?? (Array.isArray(args.argv) ? args.argv.join(" ") : null);
                return cmd ? { tool, summary: cmd } : { tool, summary: "(no command)" };
              }
              if (tool === "read" || tool === "write" || tool === "edit" || tool === "delete" || tool === "apply_patch") {
                const path = args.path ?? args.file ?? args.target;
                return path ? { tool, summary: String(path) } : { tool, summary: "(no path)" };
              }
              if (Object.keys(args).length > 0) {
                return { tool, summary: JSON.stringify(args).slice(0, 120) + (JSON.stringify(args).length > 120 ? "…" : "") };
              }
              return { tool, summary: null };
            });
            if (actionSummary.length > 0 && actionSummary.some((a) => a.summary)) {
              return (
                <>
                  <div class="drawer-section-header" title="What the agent actually executed or accessed" style={{ marginTop: 0 }}>What the agent did</div>
                  <div class="detail-block">
                    {actionSummary.map((a, i) => (
                      <div key={i} class="detail-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: "4px" }}>
                        <span class="detail-label">{a.tool}</span>
                        <pre class="mono" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: "13px" }}>{a.summary}</pre>
                      </div>
                    ))}
                  </div>
                </>
              );
            }
            return null;
          })()}

          <div class="drawer-section-header" title="For chat traces: the user message. For tool traces: the tool or capability being invoked." style={{ marginTop: "24px" }}>Input</div>
          <div class="detail-block">
            <div class="detail-row"><span class="detail-label">Message history</span><span class="mono">{trace.input?.message_history ?? "-"}</span></div>
            <pre class="mono" style={{ marginTop: "10px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{trace.input?.message || "-"}</pre>
          </div>

          {trace.output && (
            <>
              <div class="drawer-section-header">Output</div>
              <div class="detail-block">
                <pre class="mono" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{trace.output?.message || "-"}</pre>
                {!!(trace.output?.tool_calls || []).length && (
                  <div style={{ marginTop: "10px" }}>
                    <div class="text-secondary" style={{ fontSize: "12px", marginBottom: "6px" }}>Tool calls</div>
                    {(trace.output.tool_calls || []).map((tc) => (
                      <div key={tc.id} class="detail-row">
                        <span class="mono">{tc.name}</span>
                        <span class="text-secondary" style={{ fontSize: "12px" }}>{tc.permitted ? "permitted" : "denied"} · {tc.success ? "success" : "error"} · {tc.duration_ms}ms</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'governance' && (
        <div class="tab-content animate-fade-in">
          <div class="drawer-section-header" style={{ marginTop: 0 }}>Decision timeline</div>
          <div class="detail-block">
            <div class="detail-row">
              <span class="detail-label">Execution</span>
              <span class="mono">{gov.execution_id || trace.labels?.execution_id || "-"}</span>
            </div>
            <div class="detail-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: "6px" }}>
              <span class="detail-label">Decision</span>
              <div class="mono" style={{ 
                background: "var(--bg-panel)", 
                padding: "8px 12px", 
                borderRadius: "6px", 
                width: "100%", 
                whiteSpace: "pre-wrap",
                border: "1px solid var(--border-panel)",
                fontSize: "12px",
                lineHeight: "1.5",
                color: "var(--text-primary)"
              }}>
                {gov.decision_summary || "-"}
              </div>
            </div>
            <div class="detail-row">
              <span class="detail-label" title="Shown when a human or policy made an explicit approval; auto-allowed requests often have none">Decision ID</span>
              <span class="mono">{gov.decision_id || "-"}</span>
            </div>
            {!!gov.required_role && (
              <div class="detail-row">
                <span class="detail-label">Required role</span>
                <span class="mono">{gov.required_role}</span>
              </div>
            )}
            {!!gov.expires_at && (
              <div class="detail-row">
                <span class="detail-label">Expires</span>
                <span class="mono">{gov.expires_at}</span>
              </div>
            )}
            {!!gov.policy_bundle_hash && (
              <div class="detail-row">
                <span class="detail-label" title="SHA-256 hash of policy bundle at evaluation time">Policy bundle hash</span>
                <span class="mono" style={{ fontSize: "11px", wordBreak: "break-all" }}>{gov.policy_bundle_hash}</span>
              </div>
            )}
            <div class="detail-row">
              <span class="detail-label">Tool auth</span>
              <div style={{ display: "flex", gap: "6px" }}>
                <span class="badge-pill success">
                  {(trace.tool_count ?? 0) - (deniedTools.length || 0)} allow
                </span>
                <span class={\`badge-pill \${deniedTools.length > 0 ? "danger" : ""}\`}>
                  {deniedTools.length} deny
                </span>
              </div>
            </div>
          </div>

          <div class="drawer-section-header">Risk & Scope</div>
          <div class="detail-block">
            <div class="detail-row">
              <span class="detail-label" title="Score 0–100 (higher = riskier). Low <25, medium 25–50, high 50–75, critical 75+.">Risk</span>
              <span title="Score 0–100; higher = riskier">
                {(gov.risk_score != null ? gov.risk_score : trace.risk?.score) != null
                  ? \`\${(gov.risk_score ?? trace.risk?.score)}/100\`
                  : "—"} ({(gov.risk_level || trace.risk?.level) ?? "—"})
              </span>
            </div>
            {!!(trace.risk?.factors || []).length && (
              <div style={{ marginTop: "10px", marginBottom: "16px" }}>
                <div class="text-secondary" style={{ fontSize: "12px", marginBottom: "4px" }}>Risk factors:</div>
                <pre class="text-secondary" style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "12px" }}>{(trace.risk.factors || []).join("\\n")}</pre>
              </div>
            )}
            
            <div class="detail-row" style={{ marginTop: "16px", borderTop: "1px solid var(--border-subtle)", paddingTop: "16px" }}>
              <span class="detail-label" title="Max steps and cost allowed by policy">Scope Granted</span>
              <span class="mono">
                steps {trace.granted_scope?.max_steps ?? "—"} · cost {trace.granted_scope?.max_cost ?? "—"}
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label" title="Actual steps and cost consumed">Scope Used</span>
              <span class="mono">
                steps {trace.used_scope?.step_count ?? "—"} · cost {trace.used_scope?.actual_cost != null ? Number(trace.used_scope.actual_cost).toFixed(4) : "—"}
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Within scope limits</span>
              <span class="mono">{scopeDelta.within_scope == null ? "—" : (scopeDelta.within_scope ? "yes" : "no")}</span>
            </div>
          </div>

          {!!(policyIds || []).length && (
            <>
              <div class="drawer-section-header">Policy matches</div>
              <div class="detail-block">
                <div class="detail-row" style={{ flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
                  <span class="detail-label">Policy IDs</span>
                  <span class="mono" style={{ lineHeight: "1.5" }}>{policyIds.join(", ")}</span>
                </div>
                {!!deniedTools.length && (
                  <div style={{ marginTop: "16px", borderTop: "1px solid var(--border-subtle)", paddingTop: "12px" }}>
                    <div class="text-secondary" style={{ fontSize: "12px", marginBottom: "8px" }}>Denied tools</div>
                    {deniedTools.map((d, i) => (
                      <div key={i} class="detail-row" style={{ marginBottom: "6px" }}>
                        <span class="mono">{d.tool}</span>
                        <span class="text-secondary" style={{ fontSize: "12px", maxWidth: "60%", textAlign: "right" }}>
                          {d.policy_id ? \`policy: \${d.policy_id}\` : "policy"}{d.reason ? \` · \${d.reason}\` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {isFallbackOnlyTrace(trace) && hasPermission("policy:manage") && (
            <>
              <div class="drawer-section-header">No governing policy</div>
              <div class="detail-block" style={{ borderLeft: "3px solid var(--accent-warn)", background: "var(--bg-subtle)" }}>
                <p class="text-secondary" style={{ fontSize: "13px", margin: "0 0 12px 0" }}>
                  No governing policy matched this tool. Only the fallback rule applied.
                </p>
                <button
                  class="btn-primary btn-sm"
                  onClick={() => { policyDraftPanel.value = { open: true, trace }; }}
                >
                  Create policy from this trace
                </button>
              </div>
            </>
          )}

          {!!gov.decision_id && (gov.decision_trace?.length > 0) && (
            <>
              <div class="drawer-section-header">Decision record</div>
              <div class="detail-block" style={{ background: "var(--bg-subtle)", border: "1px solid var(--border-panel)" }}>
                <div style={{ display: "grid", gap: "6px" }}>
                  {gov.decision_trace.map((entry, i) => (
                    <div key={i} class="text-secondary" style={{ fontSize: "11px", padding: "8px 10px", background: "var(--bg-panel)", borderRadius: "6px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span class="mono" style={{ color: "var(--text-primary)", fontWeight: 500 }}>{entry.policy_id}</span>
                        <span>
                          <span style={{ opacity: 0.8 }}>{entry.result}</span>
                          {entry.decision && <span style={{ marginLeft: "6px", fontWeight: "bold" }}>→ {entry.decision}</span>}
                        </span>
                      </div>
                      {entry.explanation && <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{entry.explanation}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {hasPermission("audit:view") && (
            <>
              <div class="drawer-section-header">Replay & simulation</div>
              <div class="detail-block" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <button
                  class="btn-secondary btn-sm"
                  onClick={runReplay}
                  disabled={replayLoading}
                  title="Get replay context for this trace (debugging, policy simulation)"
                >
                  {replayLoading ? "Loading…" : "Replay"}
                </button>
                {!!gov.decision_id && (
                <button
                  class="btn-secondary btn-sm"
                  onClick={runSimulate}
                  disabled={simulateLoading}
                  title="Re-run policy evaluation with current policy bundle"
                >
                  {simulateLoading ? "Simulating…" : "Simulate policy"}
                </button>
                )}
                {replayResult?.error && (
                  <div class="text-danger" style={{ marginTop: "8px", fontSize: "12px", width: "100%" }}>{replayResult.error}</div>
                )}
                {replayResult && !replayResult.error && (
                  <div style={{ marginTop: "12px", padding: "10px", background: "var(--bg-subtle)", borderRadius: "6px", fontSize: "12px", width: "100%" }}>
                    <div class="text-secondary" style={{ marginBottom: "4px" }}>Replay context</div>
                    <div class="mono">{replayResult.message ?? replayResult.status}</div>
                    {replayResult.original_trace && (
                      <div style={{ marginTop: "6px" }}>Trace: {replayResult.original_trace.id?.slice(0, 8)}… · {replayResult.original_trace.steps?.length ?? 0} steps</div>
                    )}
                  </div>
                )}
                {simulateResult?.error && (
                  <div class="text-danger" style={{ marginTop: "8px", fontSize: "12px", width: "100%" }}>{simulateResult.error}</div>
                )}
                {simulateResult && !simulateResult.error && (
                  <div style={{ marginTop: "12px", padding: "10px", background: "var(--bg-subtle)", borderRadius: "6px", fontSize: "12px", width: "100%" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                      <div>
                        <div class="text-secondary" style={{ marginBottom: "4px" }}>Original</div>
                        <div class="mono">decision: {simulateResult.original?.decision ?? "—"}</div>
                        <div class="mono">risk: {simulateResult.original?.risk_score ?? "—"}/100 ({simulateResult.original?.risk_level ?? "—"})</div>
                      </div>
                      <div>
                        <div class="text-secondary" style={{ marginBottom: "4px" }}>Simulated (current policies)</div>
                        <div class="mono">decision: {simulateResult.simulated?.decision ?? "—"}</div>
                        <div class="mono">policy_bundle_hash: {(simulateResult.simulated?.policy_bundle_hash ?? "").slice(0, 16)}…</div>
                      </div>
                    </div>
                    {simulateResult.original?.decision !== simulateResult.simulated?.decision && (
                      <div class="badge-pill warn" style={{ marginTop: "8px" }}>Decision would change</div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'execution' && (
        <div class="tab-content animate-fade-in">
          <div class="drawer-section-header" style={{ marginTop: 0 }}>Execution Details</div>
          <div class="detail-block">
            <div class="detail-row"><span class="detail-label">Environment</span><span>{trace.environment}</span></div>
            <div class="detail-row">
                <span class="detail-label" title="Verification status of the trace source">Trust</span>
                <span class="mono" title="Local/self-attested; verification may be unavailable in OSS mode">
                    {trace.trust_status ? (TRUST_LABEL[trace.trust_status] ?? titleCase(trace.trust_status)) : "-"} (local)
                </span>
            </div>
            <div class="detail-row">
                <span class="detail-label" title="Cryptographic integrity of the trace">Integrity</span>
                <span class="mono" title="Unsigned traces are expected for local adapters">
                    {trace.integrity?.status || "-"} (self-attested)
                </span>
            </div>
            {(trace.agent_id || trace.labels?.agent_id) && (
              <div class="detail-row">
                <span class="detail-label" title="Agent identifier for per-agent policy matching">Agent ID</span>
                <span class="mono">{trace.agent_id || trace.labels?.agent_id}</span>
              </div>
            )}
            <div class="detail-row" style={{ marginTop: "16px", borderTop: "1px solid var(--border-subtle)", paddingTop: "16px" }}>
              <span class="detail-label" title="Tools or capabilities the agent requested to use">Requested Caps</span>
              <span class="mono" style={{ maxWidth: "60%", textAlign: "right" }}>{requested.join(", ") || "-"}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Tools</span>
              <span class="mono" style={{ maxWidth: "60%", textAlign: "right", wordBreak: "break-all" }}>{(trace.tool_names || []).join(", ") || "-"}</span>
            </div>
          </div>

          <div class="drawer-section-header">Execution graph</div>
          <div class="exec-graph">
            <div class="exec-graph-node exec-graph-prompt">
              <span class="exec-graph-label">Prompt</span>
              <span class="exec-graph-detail">Input → agent</span>
            </div>
            <div class="exec-graph-node exec-graph-policy">
              <span class="exec-graph-label">Policy decision</span>
              <span class="exec-graph-detail"><GovernanceBadge decision={gov.decision || "unknown"} /></span>
            </div>
            {(gov.decision === "approved_local" || gov.decision === "pending_approval") && (
              <div class="exec-graph-node exec-graph-approval">
                <span class="exec-graph-label">Approval</span>
                <span class="exec-graph-detail">{gov.decision === "approved_local" ? "Local approval" : "Pending"}</span>
              </div>
            )}
            {(() => {
              const steps = trace.steps || [];
              const nodes = [];
              for (let i = 0; i < steps.length; i++) {
                const s = steps[i];
                const d = s?.data || {};
                if (s.type === "llm_call") {
                  const prev = nodes[nodes.length - 1];
                  if (prev?.type === "reasoning") {
                    prev.count++;
                  } else {
                    nodes.push({ type: "reasoning", count: 1 });
                  }
                } else if (s.type === "tool_call") {
                  nodes.push({ type: "tool_call", tool: d.toolName || "tool", permitted: d.permitted });
                } else if (s.type === "tool_result") {
                  const prev = nodes[nodes.length - 1];
                  if (prev?.type === "tool_call") {
                    prev.result = d.success ? "success" : "error";
                  } else {
                    nodes.push({ type: "tool_result", tool: d.toolName || "tool", success: d.success });
                  }
                } else if (s.type === "error") {
                  nodes.push({ type: "error", code: d.code });
                }
              }
              return nodes.map((n, i) => {
                if (n.type === "reasoning") {
                  return (
                    <div key={\`r-\${i}\`} class="exec-graph-node exec-graph-reasoning">
                      <span class="exec-graph-label">Reasoning</span>
                      <span class="exec-graph-detail">{\`\${n.count} LLM call\${n.count !== 1 ? "s" : ""}\`}</span>
                    </div>
                  );
                }
                if (n.type === "tool_call") {
                  return (
                    <div key={\`t-\${i}\`} class="exec-graph-node exec-graph-tool">
                      <span class="exec-graph-label">Tool call</span>
                      <span class="exec-graph-detail mono">{\`\${n.tool} · \${n.permitted ? "permitted" : "denied"}\${n.result ? \` → \${n.result}\` : ""}\`}</span>
                    </div>
                  );
                }
                if (n.type === "tool_result") {
                  return (
                    <div key={\`tr-\${i}\`} class="exec-graph-node exec-graph-exec">
                      <span class="exec-graph-label">Execution</span>
                      <span class="exec-graph-detail mono">{\`\${n.tool} · \${n.success ? "success" : "error"}\`}</span>
                    </div>
                  );
                }
                if (n.type === "error") {
                  return (
                    <div key={\`e-\${i}\`} class="exec-graph-node exec-graph-error">
                      <span class="exec-graph-label">Error</span>
                      <span class="exec-graph-detail">{n.code || "error"}</span>
                    </div>
                  );
                }
                return null;
              });
            })()}
          </div>

          <div class="drawer-section-header">
            Execution Steps ({(trace.steps || []).length})
          </div>
          <div class="steps">
              {(trace.steps || []).map((s, i) => (
              <div key={i} class="step">
                  <div class="detail-row">
                  <strong>{stepTitle(s)}</strong>
                  <span class="mono text-secondary">{s.duration_ms}ms</span>
                  </div>
                  {stepActionPreview(s) && (
                    <pre class="mono" style={{ margin: "6px 0", padding: "8px", background: "var(--bg-panel)", borderRadius: "4px", fontSize: "12px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{stepActionPreview(s)}</pre>
                  )}
                  <div class="text-secondary" style={{ fontSize: "12px" }}>{s.timestamp}</div>
                  <details style={{ marginTop: "6px" }}>
                  <summary class="text-secondary" style={{ fontSize: "12px", cursor: "pointer" }}>View step data</summary>
                  <pre class="mono" style={{ marginTop: "8px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{json(s.data)}</pre>
                  </details>
              </div>
              ))}
          </div>
        </div>
      )}

      {activeTab === 'json' && (
        <div class="tab-content animate-fade-in">
          <div class="detail-block">
            <pre class="mono" style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "12px", wordBreak: "break-word", overflowX: "hidden" }}>
              {JSON.stringify(trace, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
`;

const finalStr = content.substring(0, startIndex) + newContentStr + "\n" + content.substring(endIndex);
fs.writeFileSync(file, finalStr);
console.log("Replaced successfully");
