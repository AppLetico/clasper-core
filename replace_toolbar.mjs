import fs from 'fs';
import path from 'path';
const file = path.join(process.cwd(), 'src/ops-ui/src/views/traces.jsx');
let content = fs.readFileSync(file, 'utf8');

const oldStrStart = `<div class="toolbar">`;
const oldStrEnd = `</div>
        </div>

        {diffModalOpen && (`;

const startIndex = content.indexOf(oldStrStart);
const endIndex = content.indexOf(oldStrEnd);

if (startIndex === -1 || endIndex === -1) {
  console.log("Could not find start or end");
  process.exit(1);
}

const newToolbar = `<div class="toolbar" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "20px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
            <div class="toolbar-group">
              <select class="select-sm" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
                <option value="">Status: All</option>
                <option value="success">Success</option>
                <option value="error">Error</option>
              </select>
              <select class="select-sm" value={filters.risk} onChange={(e) => setFilters((f) => ({ ...f, risk: e.target.value }))}>
                <option value="">Risk: All</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
              <select class="select-sm" value={filters.adapter} onChange={(e) => setFilters((f) => ({ ...f, adapter: e.target.value }))}>
                <option value="">Adapter: All</option>
                {[...new Set(adapters.map((a) => a.adapter_id))].map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
              <select class="select-sm" value={filters.governance} onChange={(e) => setFilters((f) => ({ ...f, governance: e.target.value }))}>
                <option value="">Governance: All</option>
                <option value="allow">Approved</option>
                <option value="deny">Denied</option>
              </select>
              <input
                type="text"
                class="input-sm"
                placeholder="Agent ID"
                value={filters.agent_id || ""}
                onChange={(e) => setFilters((f) => ({ ...f, agent_id: e.target.value }))}
                style={{ width: "120px" }}
              />
              <button class="btn-primary btn-sm" onClick={search}>Search</button>
            </div>
            <div>
              <button class="btn-secondary btn-sm" onClick={() => setDiffModalOpen(true)} title="Compare two traces">
                Trace diff
              </button>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <button class="btn-ghost btn-sm" style={{ paddingLeft: 4, paddingRight: 4, fontWeight: 500 }} onClick={() => { reset(); load(); }}>Reset</button>
              {(filters.start_date || filters.end_date) && (
                <span class="text-secondary text-xs">
                  Date: {filters.start_date || "…"} → {filters.end_date || "…"}
                </span>
              )}
            </div>
            <div>
              <button class="btn-secondary btn-sm" onClick={handleRefresh} title="Refresh">
                <RefreshIcon width={14} /> Refresh
              </button>
            </div>
          </div>`;

const finalStr = content.substring(0, startIndex) + newToolbar + content.substring(endIndex);
fs.writeFileSync(file, finalStr);
console.log("Replaced successfully");
