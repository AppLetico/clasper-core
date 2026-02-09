import { useEffect, useState } from "preact/hooks";
import { tenantId, selectedWorkspace, showToast } from "../state.js";
import { api, buildParams, apiPost } from "../api.js";
import { Badge } from "../components/badge.jsx";
import { RefreshIcon } from "../components/icons.jsx";

export function PoliciesView() {
  const [policies, setPolicies] = useState(null);
  const [policyTenant, setPolicyTenant] = useState("");
  const [policyJson, setPolicyJson] = useState("");
  const [dryRunJson, setDryRunJson] = useState("");
  const [dryResult, setDryResult] = useState(null);

  const load = async () => {
    try {
      const data = await api(`/ops/api/policies?${buildParams()}`);
      setPolicies(data.policies || []);
    } catch { setPolicies([]); }
  };

  useEffect(() => { load(); }, [tenantId.value, selectedWorkspace.value]);

  const savePolicy = async () => {
    try {
      const parsed = JSON.parse(policyJson);
      await apiPost("/ops/api/policies", { ...parsed, tenant_id: policyTenant || tenantId.value });
      showToast("Policy saved", "success");
      load();
    } catch (e) { showToast(`Error: ${e.message}`, "error"); }
  };

  const testPolicy = async () => {
    try {
      const parsed = JSON.parse(dryRunJson);
      const result = await apiPost("/ops/api/policies/dry-run", { ...parsed, tenant_id: tenantId.value });
      setDryResult(JSON.stringify(result, null, 2));
    } catch (e) { setDryResult(`Error: ${e.message}`); }
  };

  return (
    <section>
      <div class="grid-layout">
        <div class="panel">
          <div class="panel-header">
            <h3 data-tooltip="Governance policies currently enforced across tenants and workspaces">Active Policies</h3>
            <button class="btn-icon" data-tooltip="Reload the policy list" onClick={load}><RefreshIcon /></button>
          </div>
          <div class="policy-list">
            {policies === null && <div class="empty-state"><div class="spinner" /></div>}
            {policies && !policies.length && <div class="empty-state">No policies loaded.</div>}
            {policies && policies.map((p) => (
              <div key={p.policy_id} class="detail-block">
                <div class="detail-row"><strong>{p.policy_id}</strong><Badge text={p.enabled ? "Enabled" : "Disabled"} kind={p.enabled ? "success" : "warn"} /></div>
                <div class="detail-meta">{p.effect?.decision} · Scope: {p.scope?.tenant_id}</div>
              </div>
            ))}
          </div>
        </div>
        <div class="panel side-panel">
          <div class="panel-header"><h3 data-tooltip="Create or update a governance policy, or test one with a dry run">Editor</h3></div>
          <div class="panel-body">
            <div class="form-group"><label data-tooltip="Tenant this policy applies to — leave blank to use the current tenant">Tenant Scope</label><input placeholder="Tenant ID" value={policyTenant} onInput={(e) => setPolicyTenant(e.target.value)} /></div>
            <div class="form-group"><label data-tooltip="Full policy definition in JSON format (conditions, effect, scope)">Policy JSON</label><textarea class="code-editor" placeholder={"{ ... }"} value={policyJson} onInput={(e) => setPolicyJson(e.target.value)} /></div>
            <button class="btn-primary w-full" data-tooltip="Persist this policy — it will be enforced immediately" onClick={savePolicy}>Save Policy</button>
            <div class="divider" />
            <div class="form-group"><label data-tooltip="Simulate a request context to see how policies would evaluate it">Dry Run Input</label><textarea class="code-editor small" placeholder="Request context JSON..." value={dryRunJson} onInput={(e) => setDryRunJson(e.target.value)} /></div>
            <button class="btn-secondary w-full" data-tooltip="Evaluate policies against this input without side effects" onClick={testPolicy}>Test Policy</button>
            {dryResult && <pre class="result-box" style={{ marginTop: "12px", fontSize: "12px", whiteSpace: "pre-wrap" }}>{dryResult}</pre>}
          </div>
        </div>
      </div>
    </section>
  );
}
