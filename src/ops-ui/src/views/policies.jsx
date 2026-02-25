import { useEffect, useState } from "preact/hooks";
import { tenantId, selectedWorkspace, showToast, policyDraftPanel } from "../state.js";
import { api, buildParams, apiPost, apiPatch, apiDelete } from "../api.js";
import { Badge } from "../components/badge.jsx";
import { RefreshIcon, XIcon, ShieldIcon, LockIcon, ThumbsUpIcon } from "../components/icons.jsx";

/** Build the policy payload for POST (no tenant_id at top level; scope.tenant_id is used). */
function policyToEditPayload(p) {
  if (!p) {
    return {
      policy_id: "my_policy",
      scope: {},
      subject: { type: "tool" },
      conditions: {},
      effect: { decision: "allow" },
      explanation: "",
      precedence: 0,
      enabled: true,
    };
  }
  const { policy_id, scope, subject, conditions, effect, explanation, precedence, enabled } = p;
  return {
    policy_id: policy_id ?? "",
    scope: scope ?? {},
    subject: subject ?? { type: "tool" },
    conditions: conditions ?? {},
    effect: effect ?? { decision: "allow" },
    explanation: explanation ?? "",
    precedence: precedence ?? 0,
    enabled: enabled ?? true,
  };
}

function isWizardCreatedAttested(policy) {
  const meta = policy?._wizard_meta;
  return Boolean(meta?.created_via_wizard === true && meta?.wizard_meta_attested === true);
}

/** Count how many exception rules point to this policy (policies with exception_for_policy_id === policyId). */
function countExceptionsForPolicy(policyId, allPolicies) {
  if (!policyId || !Array.isArray(allPolicies)) return 0;
  return allPolicies.filter(
    (p) =>
      p?.policy_id !== policyId &&
      p?._wizard_meta &&
      typeof p._wizard_meta === "object" &&
      p._wizard_meta.exception_for_policy_id === policyId
  ).length;
}

function getExceptionsForPolicy(policyId, allPolicies) {
  if (!policyId || !Array.isArray(allPolicies)) return [];
  return allPolicies.filter(
    (p) =>
      p?.policy_id !== policyId &&
      p?._wizard_meta &&
      typeof p._wizard_meta === "object" &&
      p._wizard_meta.exception_for_policy_id === policyId
  );
}

const POLICY_REGISTRY_TOOLTIP =
  "Policies define pre-execution governance rules for agent actions, including allow, deny, and require-approval decisions. Each policy specifies an effect, optional conditions, and a scope. Policies are evaluated before execution occurs. Deterministic condition operators include eq, in, prefix, all_under, any_under, and exists. Guardrail: prefix rules are broad; prefer strict in and scoped path operators for security-sensitive exceptions. Click a policy to edit it, enable or disable enforcement, or run a dry-run test against recent traces.";

export function PoliciesView() {
  const [policies, setPolicies] = useState(null);
  const [drawerStack, setDrawerStack] = useState([]);
  const selectedPolicy = drawerStack[drawerStack.length - 1] || null;
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Drawer state
  const [policyJson, setPolicyJson] = useState("");
  const [dryRunJson, setDryRunJson] = useState("");
  const [dryResult, setDryResult] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = async (isManual = false) => {
    try {
      const data = await api(`/ops/api/policies?${buildParams()}`);
      setPolicies(data.policies || []);
      if (isManual === true) showToast("Policies refreshed", "success");
    } catch (e) {
      showToast("Failed to load policies", "error");
    }
  };

  useEffect(() => {
    load();
  }, [tenantId.value, selectedWorkspace.value]);

  const openDrawer = (policy, push = false) => {
    if (!policy) return;
    setDrawerStack(prev => push && drawerOpen ? [...prev, policy] : [policy]);
    setDrawerOpen(true);
    setDryResult(null);
    const payload = policyToEditPayload(policy);
    setPolicyJson(JSON.stringify(payload, null, 2));
    setDryRunJson("");
  };

  const popDrawer = () => {
    if (drawerStack.length > 1) {
      const newStack = drawerStack.slice(0, -1);
      const prevPolicy = newStack[newStack.length - 1];
      setDrawerStack(newStack);
      setDryResult(null);
      const payload = policyToEditPayload(prevPolicy);
      setPolicyJson(JSON.stringify(payload, null, 2));
      setDryRunJson("");
    } else {
      closeDrawer();
    }
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setDrawerStack([]);
    setToggling(false);
    setDeleting(false);
    setDryResult(null);
  };

  const openWizardEditor = (policy) => {
    if (!policy) return;
    policyDraftPanel.value = { open: true, mode: "edit", policy, trace: null };
  };

  const openCreatePolicyWizard = () => {
    const tenant = tenantId.value || "local";
    const workspace = selectedWorkspace.value || "local";
    const trace = {
      id: `policy-wizard-${Date.now()}`,
      tenant_id: tenant,
      workspace_id: workspace,
      tool_group: "runtime",
      tool_names: ["exec"],
      request_snapshot: {
        request: {
          tool: "exec",
          tool_group: "runtime",
          workspace_id: workspace,
          context: {
            exec: { argv0: "exec", cwd: "{{workspace.root}}" },
            targets: { paths: ["{{workspace.root}}"] },
          },
          templateVars: {
            "workspace.root": "{{workspace.root}}",
          },
        },
      },
      context: {
        exec: { argv0: "exec", cwd: "{{workspace.root}}" },
        targets: { paths: ["{{workspace.root}}"] },
      },
    };
    policyDraftPanel.value = { open: true, mode: "create", trace, policy: null };
  };

  const setPolicyEnabled = async (policy, enabled) => {
    if (!policy) return;
    setToggling(true);
    try {
      await apiPatch(`/ops/api/policies/${encodeURIComponent(policy.policy_id)}`, {
        tenant_id: policy.tenant_id || tenantId.value,
        enabled,
      });
      showToast(`${policy.policy_id} ${enabled ? "enabled" : "disabled"}`, "success");
      const data = await api(`/ops/api/policies?${buildParams()}`);
      const nextPolicies = data.policies || [];
      setPolicies(nextPolicies);
      const updated = nextPolicies.find((p) => p.policy_id === policy.policy_id);
      if (updated) setSelectedPolicy(updated);
    } catch (e) {
      showToast(`Error: ${e.message}`, "error");
    } finally {
      setToggling(false);
    }
  };

  const deletePolicyById = async () => {
    if (!selectedPolicy) return;
    if (!confirm(`Are you sure you want to delete policy "${selectedPolicy.policy_id}"?`)) return;
    setDeleting(true);
    try {
      await apiDelete(`/ops/api/policies/${encodeURIComponent(selectedPolicy.policy_id)}`, {
        tenant_id: selectedPolicy.tenant_id || tenantId.value,
      });
      showToast("Policy deleted", "success");
      await load();
      closeDrawer();
    } catch (e) {
      showToast(`Error: ${e.message}`, "error");
    } finally {
      setDeleting(false);
    }
  };

  const testPolicy = async () => {
    try {
      const parsed = JSON.parse(dryRunJson);
      const result = await apiPost("/ops/api/policies/dry-run", {
        ...parsed,
        tenant_id: tenantId.value,
      });
      setDryResult(JSON.stringify(result, null, 2));
    } catch (e) {
      setDryResult(`Error: ${e.message}`);
    }
  };

  const loadDryRunTemplate = () => {
    setDryRunJson(JSON.stringify({
      tenant_id: tenantId.value || "local",
      workspace_id: selectedWorkspace.value || "local",
      tool: "exec",
      tool_group: "runtime",
      requested_capabilities: ["exec"],
      skill_state: "active",
      context: {
        exec: { argv0: "ls", argv: ["ls", "-la"], cwd: "/workspace/demo" },
        targets: { paths: ["/workspace/demo/src/index.ts"] }
      }
    }, null, 2));
  };

  const getPolicyIcon = (decision) => {
    switch (decision) {
      case "deny": return <ShieldIcon width={16} strokeWidth={2.5} style={{ color: "var(--accent-danger)" }} />;
      case "require_approval": return <LockIcon width={16} strokeWidth={2.5} style={{ color: "var(--accent-warn)" }} />;
      default: return <ThumbsUpIcon width={16} strokeWidth={2.5} style={{ color: "var(--accent-success)" }} />;
    }
  };

  const selectedPolicyExceptions =
    selectedPolicy && Array.isArray(policies)
      ? getExceptionsForPolicy(selectedPolicy.policy_id, policies)
      : [];

  return (
    <section>
      <div class="panel">
        <div class="panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 data-tooltip={POLICY_REGISTRY_TOOLTIP}>Policy Registry</h3>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div class="text-secondary text-xs">{policies ? policies.length : 0} policies</div>
            <button class="btn-secondary btn-sm" data-tooltip="Reload the policy list" onClick={() => load(true)}>
              <RefreshIcon width={14} /> Refresh
            </button>
            <button class="btn-primary" onClick={openCreatePolicyWizard} style={{ height: "32px", fontSize: "12px", padding: "0 12px" }}>
              + New Policy
            </button>
          </div>
        </div>

        <div class="panel-body p-0">
          <div class="list-group">
            {policies === null && (
              <div class="empty-state">
                <div class="spinner" />
              </div>
            )}
            {policies && !policies.length && (
              <div class="empty-state">No policies. Create one with <strong>New policy</strong>.</div>
            )}
            {policies &&
              policies.map((p) => (
                <div
                  key={p.policy_id}
                  class="detail-block card-item"
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "16px",
                  }}
                  onClick={() => openDrawer(p)}
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        marginBottom: "4px",
                      }}
                    >
                      {getPolicyIcon(p.effect?.decision)}
                      <strong style={{ fontSize: "14px", color: "var(--text-primary)" }}>{p.policy_id}</strong>
                      <Badge text={p.enabled ? "Enabled" : "Disabled"} kind={p.enabled ? "success" : "muted"} />
                      {(() => {
                        const n = countExceptionsForPolicy(p.policy_id, policies);
                        if (n === 0) return null;
                        const label = n === 1 ? "1 exception" : `${n} exceptions`;
                        return (
                          <span
                            class="badge-pill info"
                            data-tooltip={`This policy has ${label} (allow rules created from approvals that bypass this policy).`}
                            style={{ fontSize: "10px", fontWeight: "600" }}
                          >
                            {label}
                          </span>
                        );
                      })()}
                    </div>
                    <div class="text-secondary text-xs" style={{ marginLeft: "28px" }}>
                      <span style={{ textTransform: "uppercase", fontSize: "10px", fontWeight: "600", opacity: 0.8 }}>{p.effect?.decision ?? "allow"}</span>
                      <span style={{ margin: "0 6px", opacity: 0.5 }}>•</span>
                      Scope: {p.scope?.tenant_id ?? p.tenant_id ?? "—"}
                    </div>
                  </div>
                  <div style={{ color: "var(--text-tertiary)" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Policy Drawer (edit / new) */}
      <div class={`drawer ${drawerOpen ? "open" : ""}`}>
        <div class="drawer-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {drawerStack.length > 1 && (
              <button class="btn-icon" onClick={popDrawer} style={{ marginLeft: "-8px", color: "var(--text-secondary)" }} data-tooltip="Back to previous policy">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            )}
            <h3 style={{ margin: 0 }}>{selectedPolicy ? "Manage Policy" : "New Policy"}</h3>
          </div>
          <button class="btn-icon" onClick={closeDrawer}>
            <XIcon />
          </button>
        </div>
        <div class="drawer-body">
          {selectedPolicy ? (
            <div style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div class="text-secondary text-xs">
                  Tenant: <span class="mono">{selectedPolicy.scope?.tenant_id ?? selectedPolicy.tenant_id ?? "—"}</span>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button class="btn-primary btn-sm" onClick={() => openWizardEditor(selectedPolicy)}>
                    {selectedPolicy._wizard_meta?.exception_for_policy_id ? "Edit Exception" : "Edit Policy"}
                  </button>
                  <button
                    class="btn-secondary btn-sm"
                    onClick={() => setPolicyEnabled(selectedPolicy, !selectedPolicy.enabled)}
                    disabled={toggling}
                  >
                    {toggling ? "…" : selectedPolicy.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "12px" }}>
                <div style={{ marginTop: "3px" }}>
                  {getPolicyIcon(selectedPolicy.effect?.decision)}
                </div>
                <div style={{ flex: 1 }}>
                  <div class="mono" style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", wordBreak: "break-all", lineHeight: "1.4" }}>
                    {selectedPolicy.policy_id}
                  </div>
                </div>
                <div style={{ flexShrink: 0, marginTop: "2px" }}>
                  <Badge text={selectedPolicy.enabled ? "Enabled" : "Disabled"} kind={selectedPolicy.enabled ? "success" : "muted"} />
                </div>
              </div>

              {selectedPolicy._wizard_meta?.created_via_wizard && (
                <div class="text-xs text-secondary" style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                  <Badge text="Wizard" kind="info" />
                  {selectedPolicy._wizard_meta.actor_user_id && <span>By: {selectedPolicy._wizard_meta.actor_user_id}</span>}
                  {selectedPolicy._wizard_meta.attested_at && <span>Attested: {new Date(selectedPolicy._wizard_meta.attested_at).toLocaleDateString()}</span>}
                </div>
              )}

              {/* EXCEPTION PARENT LINK (If this is an exception) */}
              {selectedPolicy._wizard_meta?.exception_for_policy_id && (
                <div style={{ marginTop: "16px" }}>
                  <div class="text-secondary text-xs" style={{ textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600, marginBottom: "8px" }}>
                    Overrides Policy
                  </div>
                  <div 
                    class="mono"
                    style={{ padding: "8px 12px", borderRadius: "6px", border: "1px dashed var(--accent-primary)", background: "rgba(var(--accent-primary-rgb), 0.05)", color: "var(--accent-primary)", fontSize: "12px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px" }}
                    onClick={() => {
                      const parentPol = policies?.find(p => p.policy_id === selectedPolicy._wizard_meta.exception_for_policy_id);
                      if (parentPol) openDrawer(parentPol, true);
                    }}
                  >
                    <LockIcon width={12} />
                    {selectedPolicy._wizard_meta.exception_for_policy_id}
                  </div>
                </div>
              )}

              {/* RULE DETAILS */}
              <div style={{ marginTop: "24px", marginBottom: "24px" }}>
                <div class="text-secondary text-xs" style={{ textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600, marginBottom: "12px" }}>
                  Rule Details
                </div>
                
                <div style={{ padding: "16px", background: "var(--bg-subtle)", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}>
                  <div style={{ display: "grid", gap: "16px" }}>
                    
                    {/* Tool */}
                    <div style={{ display: "flex", gap: "12px" }}>
                      <div style={{ width: "24px", color: "var(--text-secondary)", display: "flex", justifyContent: "center" }}>
                        <div style={{ fontWeight: "bold", fontSize: "12px" }}>T</div>
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>Tool</div>
                        <div class="mono text-secondary" style={{ fontSize: "11px", marginTop: "4px" }}>
                          {selectedPolicy.subject?.name || selectedPolicy.subject?.tool || "Any"}
                        </div>
                      </div>
                    </div>

                    {/* Command */}
                    {selectedPolicy.conditions?.["context.exec.argv0"] && (
                      <div style={{ display: "flex", gap: "12px" }}>
                        <div style={{ width: "24px", color: "var(--text-secondary)", display: "flex", justifyContent: "center" }}>
                          <div class="mono" style={{ fontSize: "10px" }}>&gt;_</div>
                        </div>
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>Command Match</div>
                          <div class="mono text-secondary" style={{ fontSize: "11px", marginTop: "4px" }}>
                            {JSON.stringify(selectedPolicy.conditions["context.exec.argv0"])}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Paths */}
                    {selectedPolicy.conditions?.["context.targets.paths"] && (
                      <div style={{ display: "flex", gap: "12px" }}>
                        <div style={{ width: "24px", color: "var(--text-secondary)", display: "flex", justifyContent: "center" }}>
                          <div style={{ fontWeight: "bold", fontSize: "12px" }}>P</div>
                        </div>
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>Path Scope</div>
                          <div class="mono text-secondary" style={{ fontSize: "11px", marginTop: "4px", wordBreak: "break-all" }}>
                            {JSON.stringify(selectedPolicy.conditions["context.targets.paths"])}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* EXCEPTIONS LIST (If Parent) */}
              {selectedPolicyExceptions.length > 0 && (
                <div style={{ marginBottom: "24px" }}>
                  <div class="text-secondary text-xs" style={{ textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600, marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Exceptions ({selectedPolicyExceptions.length})</span>
                  </div>
                  
                  <div style={{ display: "grid", gap: "8px" }}>
                    {selectedPolicyExceptions.map((ep) => (
                      <div 
                        key={ep.policy_id}
                        class="detail-block"
                        style={{ padding: "12px 16px", borderRadius: "8px", border: "1px solid var(--border-subtle)", background: "var(--bg-canvas)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                        onClick={() => openDrawer(ep, true)}
                      >
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                            <ShieldIcon width={14} style={{ color: "var(--accent-success)" }} />
                            <span class="mono" style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
                              {ep.policy_id}
                            </span>
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "8px" }}>
                            <Badge text={ep.enabled ? "Enabled" : "Disabled"} kind={ep.enabled ? "success" : "muted"} />
                            <span>•</span>
                            <span><strong style={{fontWeight:500}}>By:</strong> {ep._wizard_meta?.actor_user_id || "unknown"}</span>
                          </div>
                        </div>
                        <div style={{ color: "var(--text-tertiary)" }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {selectedPolicy && (
            <details style={{ marginBottom: "24px" }}>
              <summary style={{ cursor: "pointer", fontSize: "12px", color: "var(--text-secondary)" }}>
                Show raw policy JSON (read-only)
              </summary>
              <div class="form-group" style={{ marginTop: "10px" }}>
                <textarea
                  class="code-editor"
                  value={policyJson}
                  readOnly
                  style={{ minHeight: "220px", opacity: 0.95 }}
                />
              </div>
            </details>
          )}

          <div class="drawer-section-header">Test policy (dry run)</div>
          <div class="form-group">
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
              <label data-tooltip="Request context JSON to evaluate against current policies">Dry run input</label>
              <button 
                onClick={loadDryRunTemplate} 
                class="text-xs text-secondary hover:text-primary" 
                style={{ background: "none", border: "none", cursor: "pointer", padding: "0" }}
              >
                Load Template
              </button>
            </div>
            <textarea
              class="code-editor small"
              placeholder="Request context JSON..."
              value={dryRunJson}
              onInput={(e) => setDryRunJson(e.target.value)}
              style={{ minHeight: "100px" }}
            />
          </div>
          <button class="btn-secondary w-full" onClick={testPolicy} style={{ height: "40px" }}>
            Test policy
          </button>
          {dryResult && (
            <div style={{ marginTop: "12px" }}>
               <span class="detail-label" style={{ display: "block", marginBottom: "4px", fontSize: "11px" }}>Result</span>
               <pre
                class="result-box"
                style={{ fontSize: "12px", whiteSpace: "pre-wrap", padding: "12px", background: "var(--bg-app)", border: "1px solid var(--border-subtle)", borderRadius: "8px", overflowX: "auto" }}
              >
                {dryResult}
              </pre>
            </div>
          )}

          {selectedPolicy && (
            <>
              <div class="divider" style={{ margin: "32px 0" }} />
              <div class="drawer-section-header" style={{ color: "var(--accent-danger)" }}>Danger Zone</div>
              <div style={{ padding: "16px", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: "8px", background: "rgba(239, 68, 68, 0.05)" }}>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "0", marginBottom: "12px" }}>
                  Deleting this policy will remove it permanently. This action cannot be undone.
                </p>
                <button
                  class="btn-danger w-full"
                  onClick={deletePolicyById}
                  disabled={deleting}
                  style={{ height: "36px" }}
                >
                  {deleting ? "Deleting…" : "Delete Policy"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <div class="drawer-backdrop" onClick={closeDrawer} />
    </section>
  );
}
