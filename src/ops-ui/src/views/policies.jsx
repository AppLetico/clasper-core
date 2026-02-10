import { useEffect, useState } from "preact/hooks";
import { tenantId, selectedWorkspace, showToast } from "../state.js";
import { api, buildParams, apiPost, apiPatch, apiDelete } from "../api.js";
import { Badge } from "../components/badge.jsx";
import { RefreshIcon, XIcon, HelpCircleIcon, ShieldIcon, LockIcon, ThumbsUpIcon } from "../components/icons.jsx";

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

export function PoliciesView() {
  const [policies, setPolicies] = useState(null);
  const [selectedPolicy, setSelectedPolicy] = useState(null); // PolicyRecord or null = "new policy"
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Drawer form state
  const [policyTenant, setPolicyTenant] = useState("");
  const [policyJson, setPolicyJson] = useState("");
  const [dryRunJson, setDryRunJson] = useState("");
  const [dryResult, setDryResult] = useState(null);
  const [saving, setSaving] = useState(false);
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

  const openDrawer = (policy) => {
    setSelectedPolicy(policy);
    setDrawerOpen(true);
    setDryResult(null);
    if (policy) {
      const payload = policyToEditPayload(policy);
      setPolicyTenant(policy.scope?.tenant_id || policy.tenant_id || tenantId.value || "");
      setPolicyJson(JSON.stringify(payload, null, 2));
      setDryRunJson("");
    } else {
      setPolicyTenant(tenantId.value || "");
      setPolicyJson(JSON.stringify(policyToEditPayload(null), null, 2));
      setDryRunJson("");
    }
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelectedPolicy(null);
    setSaving(false);
    setToggling(false);
    setDeleting(false);
    setDryResult(null);
  };

  const savePolicy = async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(policyJson);
      const tenant = policyTenant || tenantId.value;
      const scope = { ...(parsed.scope || {}), tenant_id: tenant };
      await apiPost("/ops/api/policies", { ...parsed, scope, tenant_id: tenant });
      showToast(selectedPolicy ? "Policy updated" : "Policy created", "success");
      const data = await api(`/ops/api/policies?${buildParams()}`);
      const nextPolicies = data.policies || [];
      setPolicies(nextPolicies);
      if (selectedPolicy && selectedPolicy.policy_id === parsed.policy_id) {
        const updated = nextPolicies.find((p) => p.policy_id === parsed.policy_id);
        if (updated) {
          setSelectedPolicy(updated);
          setPolicyJson(JSON.stringify(policyToEditPayload(updated), null, 2));
        }
      } else {
        closeDrawer();
      }
    } catch (e) {
      showToast(`Error: ${e.message}`, "error");
    } finally {
      setSaving(false);
    }
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

  const formatJson = () => {
    try {
      const parsed = JSON.parse(policyJson);
      setPolicyJson(JSON.stringify(parsed, null, 2));
    } catch (e) {
      showToast("Invalid JSON", "error");
    }
  };

  const loadDryRunTemplate = () => {
    setDryRunJson(JSON.stringify({
      tenant_id: tenantId.value || "local",
      user_id: "test-user",
      tool_name: "delete_file",
      skill_state: "active"
    }, null, 2));
  };

  const getPolicyIcon = (decision) => {
    switch (decision) {
      case "deny": return <ShieldIcon width={16} strokeWidth={2.5} style={{ color: "var(--accent-danger)" }} />;
      case "require_approval": return <LockIcon width={16} strokeWidth={2.5} style={{ color: "var(--accent-warn)" }} />;
      default: return <ThumbsUpIcon width={16} strokeWidth={2.5} style={{ color: "var(--accent-success)" }} />;
    }
  };

  return (
    <section>
      <div class="panel">
        <div class="panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 data-tooltip="Governance policies currently enforced across tenants and workspaces">
              Policy Registry
            </h3>
            <button
              class="btn-icon"
              onClick={() => setShowHelp(!showHelp)}
              title="Toggle help"
              style={{ color: showHelp ? "var(--text-primary)" : "var(--text-secondary)" }}
            >
              <HelpCircleIcon width={20} strokeWidth={3} />
            </button>
            <button class="btn-icon" data-tooltip="Reload the policy list" onClick={() => load(true)}>
              <RefreshIcon />
            </button>
          </div>
          <div class="text-secondary text-xs">{policies ? policies.length : 0} policies</div>
        </div>

        {showHelp && (
          <div
            style={{
              padding: "16px",
              borderBottom: "1px solid var(--border-subtle)",
              background: "var(--bg-subtle)",
            }}
          >
            <p class="text-secondary text-sm" style={{ lineHeight: "1.5", margin: 0 }}>
              Policies define governance rules (allow, deny, require approval) for executions. Each policy has an
              effect, optional conditions, and a scope (tenant/workspace). Click a policy to edit it, toggle
              enable/disable, or run a dry-run test. Use <strong>New policy</strong> to create one.
            </p>
          </div>
        )}

        <div class="panel-body p-0">
          <div class="list-group">
            <div
              class="detail-block card-item"
              style={{
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "16px",
                background: "var(--bg-subtle)",
                borderBottom: "1px dashed var(--border-panel)",
              }}
              onClick={() => openDrawer(null)}
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
                  <strong style={{ fontSize: "14px", color: "var(--accent-primary)" }}>+ New policy</strong>
                </div>
                <div class="text-secondary text-xs">Create a new governance policy</div>
              </div>
              <div style={{ color: "var(--text-tertiary)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </div>

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
          <h3>{selectedPolicy ? "Manage Policy" : "New Policy"}</h3>
          <button class="btn-icon" onClick={closeDrawer}>
            <XIcon />
          </button>
        </div>
        <div class="drawer-body">
          {selectedPolicy && (
            <div class="detail-block" style={{ marginBottom: "24px" }}>
              <div class="detail-row">
                <span class="detail-label">Policy ID</span>
                <span class="mono">{selectedPolicy.policy_id}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Scope (tenant)</span>
                <span class="mono">{selectedPolicy.scope?.tenant_id ?? selectedPolicy.tenant_id ?? "—"}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Status</span>
                <Badge text={selectedPolicy.enabled ? "Enabled" : "Disabled"} kind={selectedPolicy.enabled ? "success" : "muted"} />
              </div>
              <div class="detail-row">
                <span class="detail-label">Effect</span>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  {getPolicyIcon(selectedPolicy.effect?.decision)}
                  <span>{selectedPolicy.effect?.decision ?? "—"}</span>
                </div>
              </div>
              <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--border-subtle)" }}>
                <span class="detail-label" style={{ display: "block", marginBottom: "4px" }}>
                  Quick actions
                </span>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    class={selectedPolicy.enabled ? "btn-secondary" : "btn-primary"}
                    onClick={() => setPolicyEnabled(selectedPolicy, !selectedPolicy.enabled)}
                    disabled={toggling}
                    style={{ height: "32px" }}
                  >
                    {toggling ? "…" : selectedPolicy.enabled ? "Disable Policy" : "Enable Policy"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div class="drawer-section-header">Edit policy</div>
          <div class="form-group">
            <label data-tooltip="Tenant this policy applies to">Tenant scope</label>
            <input placeholder="Tenant ID" value={policyTenant} onInput={(e) => setPolicyTenant(e.target.value)} />
          </div>
          <div class="form-group">
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
              <label data-tooltip="Full policy definition (policy_id, scope, subject, conditions, effect)">Policy JSON</label>
              <button 
                onClick={formatJson} 
                class="text-xs text-secondary hover:text-primary" 
                style={{ background: "none", border: "none", cursor: "pointer", padding: "0" }}
              >
                Format JSON
              </button>
            </div>
            <textarea
              class="code-editor"
              placeholder="{ ... }"
              value={policyJson}
              onInput={(e) => setPolicyJson(e.target.value)}
              style={{ minHeight: "200px" }}
            />
          </div>
          <button
            class="btn-primary w-full"
            onClick={savePolicy}
            disabled={saving}
            style={{ height: "40px" }}
          >
            {saving ? "Saving…" : selectedPolicy ? "Save changes" : "Create policy"}
          </button>

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
