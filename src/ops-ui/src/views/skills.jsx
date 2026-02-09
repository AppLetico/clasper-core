import { useEffect, useState } from "preact/hooks";
import { selectedWorkspace } from "../state.js";
import { api, buildParams } from "../api.js";
import { Badge } from "../components/badge.jsx";

export function SkillsView() {
  const [skills, setSkills] = useState(null);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [state, setState] = useState("active");

  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedWorkspace.value) params.set("workspace_id", selectedWorkspace.value);
      const data = await api(`/ops/api/skills/registry?${params}`);
      setSkills(data.skills || []);
    } catch { setSkills([]); }
  };

  useEffect(() => { load(); }, [selectedWorkspace.value]);

  return (
    <section>
      <div class="grid-layout">
        <div class="panel">
          <div class="panel-header">
            <h3 data-tooltip="All registered skills and their current lifecycle state">Skill Registry</h3>
          </div>
          <div class="panel-body p-0">
            <div class="list-group">
              {skills === null && <div class="empty-state"><div class="spinner" /></div>}
              {skills && !skills.length && <div class="empty-state">No skills found</div>}
              {skills && skills.map((s) => (
                <div key={s.name + s.version} class="detail-block">
                  <div class="detail-row">
                    <strong>{s.name}</strong>
                    <Badge text={s.state} kind={s.state === "active" ? "success" : "warn"} />
                  </div>
                  <div class="detail-meta">v{s.version} · Last used: {s.last_used || "Never"}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div class="panel side-panel">
          <div class="panel-header"><h3 data-tooltip="Update the lifecycle state of a specific skill version">Manage Skill</h3></div>
          <div class="panel-body">
            <div class="form-group"><label data-tooltip="Unique identifier for the skill (e.g. web-scraper, summarizer)">Skill Name</label><input placeholder="e.g. web-scraper" value={name} onInput={(e) => setName(e.target.value)} /></div>
            <div class="form-group"><label data-tooltip="Semantic version of the skill to update">Version</label><input placeholder="e.g. 1.0.0" value={version} onInput={(e) => setVersion(e.target.value)} /></div>
            <div class="form-group">
              <label data-tooltip="Active: available for use. Deprecated: blocked from new invocations. Experimental: opt-in only.">Target State</label>
              <select value={state} onChange={(e) => setState(e.target.value)}>
                <option value="active">Active</option>
                <option value="deprecated">Deprecated</option>
                <option value="experimental">Experimental</option>
              </select>
            </div>
            <button class="btn-primary w-full" data-tooltip="Apply the selected state to this skill version">Update State</button>
          </div>
        </div>
      </div>
    </section>
  );
}
