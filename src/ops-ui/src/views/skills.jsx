import { useEffect, useState } from "preact/hooks";
import { selectedWorkspace, showToast } from "../state.js";
import { api, apiPost } from "../api.js";
import { Badge } from "../components/badge.jsx";
import { XIcon, HelpCircleIcon } from "../components/icons.jsx";
import { SKILL_STATE_KIND, SKILL_STATE_LABEL, titleCase } from "../labelColors.js";

export function SkillsView() {
  const [skills, setSkills] = useState(null);
  const [selectedSkill, setSelectedSkill] = useState(null); // The skill being edited in drawer
  const [showHelp, setShowHelp] = useState(false);
  
  // Form state for the drawer
  const [targetState, setTargetState] = useState("active");
  const [updating, setUpdating] = useState(false);

  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedWorkspace.value) params.set("workspace_id", selectedWorkspace.value);
      const data = await api(`/ops/api/skills/registry?${params}`);
      setSkills(data.skills || []);
    } catch { setSkills([]); }
  };

  useEffect(() => { load(); }, [selectedWorkspace.value]);

  const openDrawer = (skill) => {
    setSelectedSkill(skill);
    setTargetState(skill.state); // Pre-select current state
  };

  const closeDrawer = () => {
    setSelectedSkill(null);
    setUpdating(false);
  };

  const handleUpdateState = async () => {
    if (!selectedSkill) return;
    
    setUpdating(true);
    try {
      await apiPost(
        `/ops/api/skills/${encodeURIComponent(selectedSkill.name)}/${encodeURIComponent(selectedSkill.version)}/promote`,
        { target_state: targetState }
      );
      showToast(`${selectedSkill.name}@${selectedSkill.version} → ${targetState}`, "success");
      await load();
      closeDrawer();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      showToast(message, "error");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <section>
      <div class="panel">
        <div class="panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 data-tooltip="All registered skills and their current lifecycle state">Skill Registry</h3>
            <button 
              class="btn-icon" 
              onClick={() => setShowHelp(!showHelp)} 
              title="Toggle help"
              style={{ color: showHelp ? "var(--text-primary)" : "var(--text-secondary)" }}
            >
              <HelpCircleIcon width={20} strokeWidth={3} />
            </button>
          </div>
          <div class="text-secondary text-xs">{skills ? skills.length : 0} skills</div>
        </div>
        
        {showHelp && (
          <div style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-subtle)" }}>
            <p class="text-secondary text-sm" style={{ lineHeight: "1.5", margin: 0 }}>
              Skills are reusable capabilities registered in the workspace. Each skill has a lifecycle state: active skills are available for use, approved skills are ready for production, draft and experimental skills are in development, and deprecated skills are blocked from new invocations. Click on a skill to manage its lifecycle.
            </p>
          </div>
        )}

        <div class="panel-body p-0">
          <div class="list-group">
            {skills === null && <div class="empty-state"><div class="spinner" /></div>}
            {skills && !skills.length && <div class="empty-state">No skills found</div>}
            {skills && skills.map((s) => (
              <div 
                key={s.name + s.version} 
                class="detail-block card-item"
                style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}
                onClick={() => openDrawer(s)}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
                    <strong style={{ fontSize: "14px", color: "var(--text-primary)" }}>{s.name}</strong>
                    <Badge text={SKILL_STATE_LABEL[s.state] ?? titleCase(s.state)} kind={SKILL_STATE_KIND[s.state] || "warn"} />
                  </div>
                  <div class="text-secondary text-xs">
                    v{s.version} · Last used: {s.last_used || "Never"}
                    {s.description && <span style={{ marginLeft: "8px", opacity: 0.7 }}>— {s.description}</span>}
                  </div>
                </div>
                <div style={{ color: "var(--text-tertiary)" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Skill Drawer */}
      <div class={`drawer ${selectedSkill ? "open" : ""}`}>
        <div class="drawer-header">
          <h3>Manage Skill</h3>
          <button class="btn-icon" onClick={closeDrawer}><XIcon /></button>
        </div>
        <div class="drawer-body">
          {selectedSkill && (
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              
              <div class="detail-block">
                <div class="detail-row">
                  <span class="detail-label">Name</span>
                  <span class="mono">{selectedSkill.name}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Version</span>
                  <span class="mono">{selectedSkill.version}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Current State</span>
                  <Badge text={SKILL_STATE_LABEL[selectedSkill.state] ?? titleCase(selectedSkill.state)} kind={SKILL_STATE_KIND[selectedSkill.state] || "warn"} />
                </div>
                <div class="detail-row">
                  <span class="detail-label">Last Used</span>
                  <span>{selectedSkill.last_used || "Never"}</span>
                </div>
                {selectedSkill.description && (
                  <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--border-subtle)" }}>
                    <span class="detail-label" style={{ display: "block", marginBottom: "4px" }}>Description</span>
                    <span class="text-secondary text-sm">{selectedSkill.description}</span>
                  </div>
                )}
              </div>

              <div class="panel" style={{ border: "none", background: "var(--bg-app)", padding: "16px" }}>
                <h4 style={{ marginBottom: "16px", fontSize: "13px", textTransform: "uppercase", color: "var(--text-tertiary)", letterSpacing: "0.05em" }}>Update Lifecycle State</h4>
                
                <div class="form-group">
                  <label>Target State</label>
                  <select 
                    value={targetState} 
                    onChange={(e) => setTargetState(e.target.value)} 
                    disabled={updating}
                    style={{ height: "40px" }}
                  >
                    <option value="draft">Draft</option>
                    <option value="tested">Tested</option>
                    <option value="approved">Approved</option>
                    <option value="active">Active</option>
                    <option value="deprecated">Deprecated</option>
                  </select>
                  <div class="text-secondary text-xs" style={{ marginTop: "8px", lineHeight: "1.4" }}>
                    Changing the state affects whether agents can invoke this skill. 
                    <strong> Active</strong> skills are available to all agents. 
                    <strong> Deprecated</strong> skills are blocked.
                  </div>
                </div>
                
                <button
                  class="btn-primary w-full"
                  onClick={handleUpdateState}
                  disabled={updating || targetState === selectedSkill.state}
                  style={{ height: "40px", marginTop: "8px" }}
                >
                  {updating ? "Updating…" : "Update State"}
                </button>
              </div>

            </div>
          )}
        </div>
      </div>
      <div 
        class={`drawer-backdrop ${selectedSkill ? "" : ""}`} 
        onClick={closeDrawer} 
        style={selectedSkill ? { opacity: 1, pointerEvents: "auto" } : {}} 
      />
    </section>
  );
}
