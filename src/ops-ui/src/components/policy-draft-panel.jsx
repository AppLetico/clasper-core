import { useState, useEffect } from "preact/hooks";
import { policyDraftPanel, tenantId, showToast } from "../state.js";
import { apiPost } from "../api.js";
import { XIcon } from "./icons.jsx";

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function buildSeedFromTrace(trace, toolInput) {
  const tool = toolInput || "unknown";
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const slug = slugify(tool) || "tool";
  const suffix = Math.random().toString(36).slice(2, 6);
  const policyId = `policy-${slug}-${suffix}`;
  const explanation = `Added from blocked execution on ${dateStr}`;
  return {
    policy_id: policyId,
    scope: {
      tenant_id: trace.tenant_id || tenantId.value || "local",
      workspace_id: trace.workspace_id || undefined,
    },
    subject: { type: "tool", name: tool },
    conditions: {
      tool,
      tool_group: trace.tool_group ?? undefined,
    },
    effect: { decision: undefined },
    explanation,
    precedence: undefined,
    enabled: true,
  };
}

export function PolicyDraftPanel() {
  const { open, trace } = policyDraftPanel.value;
  const toolNames = trace?.tool_names || [];
  const defaultTool = toolNames[toolNames.length - 1] || "unknown";
  const [selectedTool, setSelectedTool] = useState(defaultTool);
  const [decision, setDecision] = useState("");
  const [precedence, setPrecedence] = useState("");
  const [saving, setSaving] = useState(false);

  const seed = open && trace ? buildSeedFromTrace(trace, selectedTool || defaultTool) : null;
  const tool = seed?.subject?.name ?? "";
  const tenant = seed?.scope?.tenant_id ?? "";
  const workspace = seed?.scope?.workspace_id ?? "";

  useEffect(() => {
    if (!open) {
      setDecision("");
      setPrecedence("");
      setSelectedTool("unknown");
      return;
    }
    setSelectedTool(defaultTool);
  }, [open, defaultTool]);

  if (!open || !trace || !seed) return null;

  const close = () => {
    policyDraftPanel.value = { open: false, trace: null };
  };

  const precedenceNum = precedence.trim() === "" ? NaN : parseInt(precedence, 10);
  const precedenceInRange =
    !isNaN(precedenceNum) && precedenceNum >= -1000 && precedenceNum <= 1000;
  const canCreate =
    (decision === "allow" || decision === "require_approval" || decision === "deny") &&
    precedenceInRange;

  const submit = async () => {
    if (!canCreate) return;
    setSaving(true);
    try {
      const payload = {
        policy_id: seed.policy_id,
        scope: { ...seed.scope },
        subject: { ...seed.subject },
        conditions: { ...seed.conditions },
        effect: { decision },
        explanation: seed.explanation,
        precedence: precedenceNum,
        enabled: true,
        _source_trace_id: trace.id,
        _source_adapter_id: trace.adapter_id ?? undefined,
      };
      await apiPost("/ops/api/policies", payload);
      showToast("Policy created", "success");
      close();
    } catch (e) {
      showToast(e?.message || "Failed to create policy", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="modal">
      <div class="modal-backdrop" onClick={close} />
      <div class="modal-dialog" style={{ maxWidth: "480px" }}>
        <div class="modal-header">
          <h3>Create policy from this trace</h3>
          <button class="btn-icon" onClick={close}><XIcon /></button>
        </div>
        <div class="modal-body">
          <div class="detail-block" style={{ marginBottom: "16px", background: "var(--bg-subtle)", padding: "12px", borderRadius: "8px" }}>
            <div class="detail-row">
              <span class="detail-label">Tool</span>
              {toolNames.length > 1 ? (
                <select
                  value={selectedTool}
                  onInput={(e) => setSelectedTool(e.target.value)}
                  style={{ minWidth: "220px" }}
                >
                  {toolNames.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              ) : (
                <span class="mono">{tool}</span>
              )}
            </div>
            <div class="detail-row"><span class="detail-label">Subject</span><span class="mono">tool / {tool}</span></div>
            <div class="detail-row"><span class="detail-label">Scope (tenant)</span><span class="mono">{tenant}</span></div>
            {workspace && (
              <div class="detail-row"><span class="detail-label">Scope (workspace)</span><span class="mono">{workspace}</span></div>
            )}
            <div class="detail-row"><span class="detail-label">Explanation seed</span><span class="text-secondary" style={{ fontSize: "12px" }}>{seed.explanation}</span></div>
          </div>

          <div class="form-group">
            <label>Effect (required)</label>
            <div style={{ display: "flex", gap: "16px", marginTop: "6px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input type="radio" name="effect" value="allow" checked={decision === "allow"} onInput={() => setDecision("allow")} />
                <span>Allow</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input type="radio" name="effect" value="require_approval" checked={decision === "require_approval"} onInput={() => setDecision("require_approval")} />
                <span>Require approval</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input type="radio" name="effect" value="deny" checked={decision === "deny"} onInput={() => setDecision("deny")} />
                <span>Deny</span>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label>Precedence (required)</label>
            <input
              type="number"
              placeholder="e.g. 10"
              value={precedence}
              onInput={(e) => setPrecedence(e.target.value)}
              min={-1000}
              max={1000}
              style={{ maxWidth: "120px" }}
            />
            <span class="text-secondary" style={{ fontSize: "11px", display: "block", marginTop: "4px" }}>
              Higher precedence wins. Typical: 10 for specific tool rules. Fallback rules use negative values.
            </span>
          </div>

          <div class="alert warn" style={{ marginTop: "16px", padding: "10px 12px", fontSize: "13px" }}>
            This policy will affect all future executions matching these conditions.
          </div>

          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "16px" }}>
            <button class="btn-ghost" onClick={close}>Cancel</button>
            <button
              class="btn-primary"
              onClick={submit}
              disabled={!canCreate || saving}
            >
              {saving ? "Creating…" : "Create policy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
