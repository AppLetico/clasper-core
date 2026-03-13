const $ = (id) => document.getElementById(id);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

// --- State & Config ---
const state = {
  permissions: [],
  user: null,
  traces: [],
  traceSort: { key: "started_at", direction: "desc" },
  tracePage: { limit: 50, offset: 0 },
  viewsLoaded: new Set()
};

let pendingOverrideCallback = null;
let pendingConfirmCallback = null;

// --- Elements ---
const tokenInput = $("tokenInput");
const saveTokenButton = $("saveToken");
const authStatusCompact = $("authStatusCompact");
const toggleAuthButton = $("menuEnterToken"); // Using menu item now
const authModal = $("authModal");
const authModalClose = $("authModalClose");
const authModalCancel = $("authModalCancel");
const pageTitle = $("pageTitle");
const healthDot = $("healthDot");
const healthText = $("healthText");
const toastContainer = $("toastContainer");
const pendingBadge = $("pendingBadge");
const globalWorkspaceSelect = $("globalWorkspaceSelect");

// User Menu
const userMenuTrigger = $("userMenuTrigger");
const userMenu = $("userMenu");
const menuSignOut = $("menuSignOut");

const traceTable = $("traceTable");
const traceDetail = $("traceDetail");
const traceDrawer = $("traceDrawer");
const traceDrawerBackdrop = $("traceDrawerBackdrop");
const closeTraceDrawer = $("closeTraceDrawer");
const runDiffButton = $("runDiff");

// Filters & Inputs
const tenantFilter = $("tenantFilter");
const agentFilter = $("agentFilter");
const statusFilter = $("statusFilter");
const riskFilter = $("riskFilter");
const trustFilter = $("trustFilter");
const refreshTraces = $("refreshTraces");
const searchTraces = $("searchTraces");
const resetTraces = $("resetTraces");
const tracePrev = $("tracePrev");
const traceNext = $("traceNext");
const tracePageInfo = $("tracePageInfo");
const tracePageSize = $("tracePageSize");

// Dashboard Metrics
const metricTracesToday = $("metricTracesToday");
const metricTraceBreakdown = $("metricTraceBreakdown");
const metricRiskSummary = $("metricRiskSummary");
const metricRiskBreakdown = $("metricRiskBreakdown");
const metricCost = $("metricCost");
const metricCostBars = $("metricCostBars");
const metricApprovals = $("metricApprovals");
const metricApprovalsHint = $("metricApprovalsHint");
const highRiskList = $("highRiskList");
const healthPanel = $("healthPanel");
const refreshDashboard = $("refreshDashboard");

// Modals
const overrideModal = $("overrideModal");
const overrideModalClose = $("overrideModalClose");
const overrideReasonCode = $("overrideReasonCode");
const overrideJustification = $("overrideJustification");
const overrideError = $("overrideError");
const overrideCancel = $("overrideCancel");
const overrideConfirm = $("overrideConfirm");

const confirmModal = $("confirmModal");
const confirmTitle = $("confirmTitle");
const confirmMessage = $("confirmMessage");
const confirmClose = $("confirmClose");
const confirmCancel = $("confirmCancel");
const confirmAccept = $("confirmAccept");

// --- Auth & Init ---
function getToken() {
  return localStorage.getItem("clasper_ops_token") || "";
}

function setToken(token) {
  localStorage.setItem("clasper_ops_token", token);
}

function headers() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchMe() {
  try {
    const response = await fetch("/ops/api/me", { headers: headers() });
    if (!response.ok) {
      setAuthText("Not authenticated");
      applyPermissions([]);
      return;
    }
    const data = await response.json();
    state.user = data.user;
    setAuthText(`${data.user.id}`);
    applyPermissions(data.permissions || []);
    
    // Auto-fill context
    if (!tenantFilter.value) tenantFilter.value = data.user.tenant_id || "";
  } catch (error) {
    setAuthText("Auth Error");
    applyPermissions([]);
  }
}

function setAuthText(text) {
  if (authStatusCompact) authStatusCompact.textContent = text;
}

// --- Navigation & Routing ---
function setActiveView(view) {
  $$(".view").forEach((section) => {
    section.classList.toggle("active", section.dataset.view === view);
  });
  $$(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.nav === view);
  });
  
  // Update breadcrumb
  pageTitle.textContent = view.charAt(0).toUpperCase() + view.slice(1);
  
  // Lazy load view data
  const loader = viewLoaders[view];
  if (loader) loader();
}

function currentWorkspaceId() {
  return globalWorkspaceSelect ? globalWorkspaceSelect.value : "";
}

function parseHash() {
  const view = window.location.hash.replace("#", "") || "dashboard";
  setActiveView(view);
}

const viewLoaders = {
  dashboard: loadDashboard,
  traces: loadTraces,
  deployments: () => {},
  skills: loadSkills,
  policies: loadPolicies,
  adapters: loadAdapters,
  approvals: loadDecisions,
  audit: loadAudit
};

// --- UI Helpers ---
function showToast(message, type = "info") {
  if (!toastContainer) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function currentTenantId() {
  return tenantFilter?.value || state.user?.tenant_id || "";
}

function formatCost(cost) {
  if (cost === undefined || cost === null || Number.isNaN(Number(cost))) return "-";
  const num = Number(cost);
  if (num === 0) return "$0.00";
  // Show 4 decimals for small fractional costs (common in LLM tokens), otherwise standard 2
  if (num < 0.01) return `$${num.toFixed(4)}`;
  return `$${num.toFixed(2)}`;
}

function badge(text, kind) {
  return `<span class="badge-pill ${kind || ''}">${text}</span>`;
}

function riskBadge(level) {
  const map = { critical: "warn", high: "warn", medium: "warn" }; // reuse warn style for now or add danger
  return badge(level || "-", map[level]);
}

function statusBadge(status) {
  const map = { success: "success", verified: "success", error: "warn", compromised: "warn" };
  return badge(status || "-", map[status]);
}

// --- Drawers ---
function openTraceDrawer() {
  traceDrawer.classList.add("open");
}

function closeDrawer() {
  traceDrawer.classList.remove("open");
}

// --- Modals ---
function showOverrideModal(message) {
  return new Promise((resolve, reject) => {
    overrideReasonCode.value = "";
    overrideJustification.value = "";
    overrideError.classList.add("hidden");
    overrideError.textContent = "";
    if (message) $("overrideJustification").placeholder = message;
    pendingOverrideCallback = { resolve, reject };
    overrideModal.classList.remove("hidden");
  });
}

function hideOverrideModal() {
  overrideModal.classList.add("hidden");
  pendingOverrideCallback = null;
}

function confirmOverride() {
  const reason = overrideReasonCode.value;
  const just = overrideJustification.value.trim();
  if (!reason || just.length < 10) {
    overrideError.textContent = "Select a reason and provide justification (10+ chars).";
    overrideError.classList.remove("hidden");
    return;
  }
  if (pendingOverrideCallback) pendingOverrideCallback.resolve({ reason_code: reason, justification: just });
  hideOverrideModal();
}

function showConfirmModal(opts) {
  return new Promise((resolve, reject) => {
    confirmTitle.textContent = opts.title || "Confirm";
    confirmMessage.textContent = opts.message || "Are you sure?";
    pendingConfirmCallback = { resolve, reject };
    confirmModal.classList.remove("hidden");
  });
}

function hideConfirmModal() {
  confirmModal.classList.add("hidden");
  pendingConfirmCallback = null;
}

// --- Dashboard Logic ---
async function loadDashboard() {
  loadHealth();
  loadTraceSummary();
  loadRiskSummary();
  loadCostSummary();
  loadApprovalsSummary();
  loadHighRiskTraces();
}

async function loadHealth() {
  try {
    const res = await fetch("/health");
    const data = await res.json();
    const isOk = data.status === "ok";
    healthDot.style.background = isOk ? "#10b981" : "#ef4444";
    healthText.textContent = isOk ? "Systems Operational" : "System Issues Detected";
    
    if (healthPanel) {
      healthPanel.innerHTML = Object.entries(data.components || {}).map(([k, v]) => `
        <div class="detail-row">
          <span class="detail-label">${k}</span>
          <span class="detail-val">${v.status || v}</span>
        </div>
      `).join("");
    }
  } catch (e) {
    healthText.textContent = "Offline";
    healthDot.style.background = "#ef4444";
  }
}

async function loadTraceSummary() {
  const params = new URLSearchParams({ 
    limit: 200, 
    start_date: new Date().toISOString().split('T')[0],
    tenant_id: currentTenantId() 
  });
  if (currentWorkspaceId()) params.set("workspace_id", currentWorkspaceId());
  
  try {
    const res = await fetch(`/ops/api/traces?${params}`, { headers: headers() });
    const data = await res.json();
    const traces = data.traces || [];
    metricTracesToday.textContent = traces.length;
    
    const success = traces.filter(t => t.status === "success").length;
    const error = traces.filter(t => t.status === "error").length;
    metricTraceBreakdown.textContent = `${success} Success · ${error} Error`;
  } catch (e) {
    metricTracesToday.textContent = "-";
  }
}

async function loadRiskSummary() {
  try {
    const params = new URLSearchParams({ tenant_id: currentTenantId() });
    if (currentWorkspaceId()) params.set("workspace_id", currentWorkspaceId());
    const res = await fetch(`/ops/api/dashboards/risk?${params}`, { headers: headers() });
    const data = await res.json();
    const levels = data.dashboard?.levels || {};
    const highCrit = (levels.high || 0) + (levels.critical || 0);
    metricRiskSummary.textContent = highCrit;
    metricRiskBreakdown.textContent = `${levels.medium || 0} Medium · ${levels.low || 0} Low`;
  } catch(e) {
    metricRiskSummary.textContent = "-";
  }
}

async function loadCostSummary() {
  try {
    const params = new URLSearchParams({ tenant_id: currentTenantId() });
    if (currentWorkspaceId()) params.set("workspace_id", currentWorkspaceId());
    const res = await fetch(`/ops/api/dashboards/cost?${params}`, { headers: headers() });
    const data = await res.json();
    const daily = data.dashboard?.daily || [];
    const total = daily.reduce((acc, d) => acc + (d.total_cost || 0), 0);
    metricCost.textContent = formatCost(total);
    
    // Render simple bars
    const max = Math.max(...daily.map(d => d.total_cost), 0.0001);
    metricCostBars.innerHTML = daily.slice(-7).map(d => `
      <span style="height: ${Math.max(10, (d.total_cost / max) * 100)}%"></span>
    `).join("");
  } catch(e) {
    metricCost.textContent = "-";
  }
}

async function loadApprovalsSummary() {
  try {
    const params = new URLSearchParams({ tenant_id: currentTenantId(), status: 'pending' });
    if (currentWorkspaceId()) params.set("workspace_id", currentWorkspaceId());
    const res = await fetch(`/ops/api/decisions?${params}`, { headers: headers() });
    const data = await res.json();
    const count = data.decisions?.length || 0;
    metricApprovals.textContent = count;
    metricApprovalsHint.textContent = count ? "Action required" : "All clear";
    
    if (pendingBadge) {
      pendingBadge.textContent = count;
      pendingBadge.classList.toggle("hidden", count === 0);
    }
  } catch(e) {
    metricApprovals.textContent = "-";
  }
}

async function loadHighRiskTraces() {
  try {
    const params = new URLSearchParams({ 
      tenant_id: currentTenantId(), 
      risk_level: 'high', 
      limit: 5 
    });
    if (currentWorkspaceId()) params.set("workspace_id", currentWorkspaceId());
    const res = await fetch(`/ops/api/traces?${params}`, { headers: headers() });
    const data = await res.json();
    const traces = data.traces || [];
    
    if (!traces.length) {
      highRiskList.innerHTML = `<div class="empty-state">No high risk traces found.</div>`;
      return;
    }
    
    highRiskList.innerHTML = traces.map(t => `
      <div class="detail-block" style="cursor:pointer" onclick="openTrace('${t.id}')">
        <div class="detail-row">
          <span class="mono">${t.id.slice(0,8)}...</span>
          ${statusBadge(t.status)}
        </div>
        <div class="detail-meta text-secondary" style="font-size:12px">
          ${t.agent_role || 'Agent'} · ${t.risk.level}
        </div>
      </div>
    `).join("");
  } catch(e) {
    highRiskList.innerHTML = `<div class="empty-state">Failed to load traces.</div>`;
  }
}

// --- Traces Logic ---
async function loadTraces() {
  traceTable.innerHTML = `
    <tr>
      <td colspan="8">
        <div class="empty-state loading">
          <div class="spinner"></div>
          <div>Loading traces...</div>
        </div>
      </td>
    </tr>`;
  
  try {
    const params = new URLSearchParams({
      tenant_id: currentTenantId(),
      limit: state.tracePage.limit,
    offset: state.tracePage.offset
  });
  
  if (currentWorkspaceId()) params.set("workspace_id", currentWorkspaceId());
  
  if (statusFilter.value) params.set("status", statusFilter.value);
    if (riskFilter.value) params.set("risk_level", riskFilter.value);
    
    const res = await fetch(`/ops/api/traces?${params}`, { headers: headers() });
    const data = await res.json();
    state.traces = data.traces || [];
    renderTracesTable();
  } catch (e) {
    console.error("Load traces error:", e);
    traceTable.innerHTML = `<tr><td colspan="8" class="empty-state">Failed to load traces</td></tr>`;
  }
}

function renderTracesTable() {
  if (!state.traces.length) {
    traceTable.innerHTML = `<tr><td colspan="8" class="empty-state">No traces found</td></tr>`;
    return;
  }
  
  traceTable.innerHTML = state.traces.map(t => `
    <tr onclick="openTrace('${t.id}')">
      <td class="mono">${t.id}</td>
      <td>${t.environment}</td>
      <td>${t.agent_role || '-'}</td>
      <td>${statusBadge(t.status)}</td>
      <td>${riskBadge(t.risk?.level)}</td>
      <td>${t.trust_status || '-'}</td>
      <td class="text-right">${formatCost(t.cost)}</td>
      <td class="text-right">${t.duration_ms || '-'}ms</td>
    </tr>
  `).join("");
  
  tracePageInfo.textContent = `Page ${Math.floor(state.tracePage.offset / state.tracePage.limit) + 1}`;
}

window.openTrace = async function(id) {
  openTraceDrawer();
  traceDetail.innerHTML = `<div class="empty-state"><div class="spinner"></div></div>`;
  
  try {
    const res = await fetch(`/ops/api/traces/${id}?tenant_id=${currentTenantId()}`, { headers: headers() });
    const data = await res.json();
    renderTraceDetail(data.trace);
  } catch (e) {
    traceDetail.innerHTML = `<div class="empty-state">Failed to load detail</div>`;
  }
};

function renderTraceDetail(trace) {
  traceDetail.innerHTML = `
    <div class="detail-block">
      <div class="detail-row"><span class="detail-label">Trace ID</span> <span class="mono">${trace.id}</span></div>
      <div class="detail-row"><span class="detail-label">Status</span> ${statusBadge(trace.status)}</div>
      <div class="detail-row"><span class="detail-label">Risk Score</span> <span>${trace.risk.score} (${trace.risk.level})</span></div>
      <div class="detail-row"><span class="detail-label">Cost</span> <span>${formatCost(trace.cost)}</span></div>
      <div class="detail-row"><span class="detail-label">Environment</span> <span>${trace.environment}</span></div>
    </div>
    
    <div class="panel-header mt-4"><h3>Execution Steps</h3></div>
    <div class="steps">
      ${(trace.steps || []).map(s => `
        <div class="step">
          <div class="detail-row">
            <strong>${s.type}</strong>
            <span class="mono text-secondary">${s.duration_ms}ms</span>
          </div>
          <div class="text-secondary" style="font-size:12px">${s.tool || ''}</div>
        </div>
      `).join("")}
    </div>
  `;
}

// --- Other Loaders (Stubs for brevity, implement similarly) ---
async function loadSkills() {
  const params = new URLSearchParams();
  if (currentWorkspaceId()) params.set("workspace_id", currentWorkspaceId());
  
  const res = await fetch(`/ops/api/skills/registry?${params}`, { headers: headers() });
  const data = await res.json();
  const list = $("skillList");
  list.innerHTML = (data.skills || []).map(s => `
    <div class="detail-block">
      <div class="detail-row">
        <strong>${s.name}</strong>
        ${badge(s.state, s.state === 'active' ? 'success' : 'warn')}
      </div>
      <div class="detail-meta">v${s.version} · Last used: ${s.last_used || 'Never'}</div>
    </div>
  `).join("") || `<div class="empty-state">No skills found</div>`;
}

async function loadPolicies() {
  const params = new URLSearchParams({ tenant_id: currentTenantId() });
  if (currentWorkspaceId()) params.set("workspace_id", currentWorkspaceId());
  
  const res = await fetch(`/ops/api/policies?${params}`, { headers: headers() });
  const data = await res.json();
  $("policiesList").innerHTML = (data.policies || []).map(p => `
    <div class="detail-block">
      <div class="detail-row"><strong>${p.policy_id}</strong> ${badge(p.enabled ? 'Enabled' : 'Disabled', p.enabled ? 'success' : 'warn')}</div>
      <div class="detail-meta">${p.effect.decision} · Scope: ${p.scope.tenant_id}</div>
    </div>
  `).join("") || `<div class="empty-state">No policies found</div>`;
}

async function loadAdapters() {
  const params = new URLSearchParams({ tenant_id: currentTenantId() });
  if (currentWorkspaceId()) params.set("workspace_id", currentWorkspaceId());

  const res = await fetch(`/ops/api/adapters?${params}`, { headers: headers() });
  const data = await res.json();
  $("adapterList").innerHTML = (data.adapters || []).map(a => `
    <div class="stat-card">
      <div class="stat-content">
        <div class="stat-label">Adapter</div>
        <div class="stat-value" style="font-size:16px">${a.display_name}</div>
        <div class="stat-meta">v${a.version} · ${a.risk_class}</div>
      </div>
    </div>
  `).join("") || `<div class="empty-state">No adapters found</div>`;
}

async function loadDecisions() {
  const params = new URLSearchParams({ tenant_id: currentTenantId(), status: 'pending' });
  if (currentWorkspaceId()) params.set("workspace_id", currentWorkspaceId());
  
  const res = await fetch(`/ops/api/decisions?${params}`, { headers: headers() });
  const data = await res.json();
  $("decisionList").innerHTML = (data.decisions || []).map(d => `
    <div class="detail-block">
      <div class="detail-row"><strong>${d.decision_id}</strong> <span class="badge-pill warn">Pending</span></div>
      <div class="mt-4 flex gap-2 justify-end">
        <button class="btn-primary btn-sm" onclick="resolveDecision('${d.decision_id}', 'approve')">Approve</button>
        <button class="btn-danger btn-sm" onclick="resolveDecision('${d.decision_id}', 'deny')">Deny</button>
      </div>
    </div>
  `).join("") || `<div class="empty-state"><div class="empty-icon">✓</div>No pending approvals</div>`;
}

window.resolveDecision = async function(id, action) {
  try {
    await showConfirmModal({ title: `${action} Decision`, message: "Confirm this action?" });
    await fetch(`/api/decisions/${id}/resolve`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, justification: "Ops console action", tenant_id: currentTenantId(), workspace_id: currentWorkspaceId() })
    });
    showToast("Decision resolved", "success");
    loadDecisions();
    loadApprovalsSummary();
  } catch(e) {}
  hideConfirmModal();
};

async function loadAudit() {
  const params = new URLSearchParams({ tenant_id: currentTenantId(), limit: 50 });
  if (currentWorkspaceId()) params.set("workspace_id", currentWorkspaceId());
  
  const res = await fetch(`/ops/api/audit?${params}`, { headers: headers() });
  const data = await res.json();
  $("auditList").innerHTML = `
    <table class="data-table">
      <thead><tr><th>Time</th><th>Event</th><th>Actor</th><th>Target</th></tr></thead>
      <tbody>
        ${(data.entries || []).map(e => `
          <tr>
            <td class="mono">${new Date(e.timestamp).toLocaleString()}</td>
            <td>${e.event_type}</td>
            <td>${e.actor}</td>
            <td class="mono">${e.target_id || '-'}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` || `<div class="empty-state">No audit logs</div>`;
}

// --- Event Listeners ---
window.addEventListener("hashchange", parseHash);

function closeAuthModal() {
  authModal.classList.add("hidden");
}

saveTokenButton.addEventListener("click", () => { 
  setToken(tokenInput.value); 
  fetchMe(); 
  closeAuthModal(); 
});

toggleAuthButton.addEventListener("click", () => {
  authModal.classList.remove("hidden");
  tokenInput.focus();
  userMenu.classList.add("hidden"); // Close menu when opening auth
});

authModalClose.addEventListener("click", closeAuthModal);
authModalCancel.addEventListener("click", closeAuthModal);

// Close auth modal on backdrop click
authModal.querySelector(".modal-backdrop").addEventListener("click", closeAuthModal);

// User Menu Toggles
userMenuTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  userMenu.classList.toggle("hidden");
  userMenuTrigger.classList.toggle("active");
});

document.addEventListener("click", (e) => {
  if (!userMenu.contains(e.target) && !userMenuTrigger.contains(e.target)) {
    userMenu.classList.add("hidden");
    userMenuTrigger.classList.remove("active");
  }
});

menuSignOut.addEventListener("click", () => {
  setToken("");
  fetchMe();
  userMenu.classList.add("hidden");
});

refreshDashboard.addEventListener("click", loadDashboard);
refreshTraces.addEventListener("click", loadTraces);
closeTraceDrawer.addEventListener("click", closeDrawer);
traceDrawerBackdrop.addEventListener("click", closeDrawer);

overrideModalClose.addEventListener("click", hideOverrideModal);
overrideCancel.addEventListener("click", hideOverrideModal);
overrideConfirm.addEventListener("click", confirmOverride);

confirmClose.addEventListener("click", hideConfirmModal);
confirmCancel.addEventListener("click", hideConfirmModal);
confirmAccept.addEventListener("click", () => pendingConfirmCallback?.resolve());

// --- Perms Helpers ---
function applyPermissions(perms) {
  state.permissions = perms;
  // Toggle buttons based on perms...
}

function hasPermission(p) { return state.permissions.includes(p); }

// --- SSE Logic ---
let eventSource = null;
let reconnectTimeout = null;

function setupSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  const tenantId = currentTenantId();
  if (!tenantId) return; // Wait until we have a tenant

  const url = new URL('/ops/api/events', window.location.origin);
  url.searchParams.set('tenant_id', tenantId);
  // Pass token if available (server dependent, usually cookies or query param)
  const token = getToken();
  if (token) url.searchParams.set('token', token);

  console.log("Connecting to SSE:", url.toString());

  try {
    eventSource = new EventSource(url);
    
    eventSource.onopen = () => {
      console.log("SSE Connected");
      // Optional: show connection status
    };

    eventSource.onerror = (err) => {
      console.error("SSE Error:", err);
      eventSource.close();
      eventSource = null;
      // Reconnect with backoff
      reconnectTimeout = setTimeout(setupSSE, 5000);
    };

    // Listen for events
    eventSource.addEventListener("trace.created", () => {
      incrementTraceCount();
      if (location.hash.includes("traces")) loadTraces(); // Refresh list if viewing traces
      // Also refresh dashboard recent traces if viewing dashboard
      if (!location.hash || location.hash === "#dashboard") loadHighRiskTraces(); 
    });

    eventSource.addEventListener("trace.completed", () => {
      // Maybe update stats?
      loadTraceSummary(); // Refresh stats fully
      if (location.hash.includes("traces")) loadTraces();
    });

    eventSource.addEventListener("decision.created", () => {
      loadApprovalsSummary();
      if (location.hash.includes("approvals")) loadDecisions();
      showToast("New approval request pending", "info");
    });

    eventSource.addEventListener("decision.resolved", () => {
      loadApprovalsSummary();
      if (location.hash.includes("approvals")) loadDecisions();
    });

    // Generic handler for debugging
    eventSource.onmessage = (e) => {
      // console.log("SSE Message:", e.data);
    };

  } catch (e) {
    console.error("Failed to setup SSE", e);
  }
}

function incrementTraceCount() {
  const el = $("metricTracesToday");
  if (el && el.textContent !== "-") {
    el.textContent = parseInt(el.textContent || "0") + 1;
  } else {
    loadTraceSummary();
  }
}

// --- Init ---
tokenInput.value = getToken();
fetchMe().then(() => {
  setupSSE(); // Connect after auth check
  loadWorkspaces();
});
parseHash();

// Helper to load workspaces for the selector
async function loadWorkspaces() {
  try {
    // This endpoint might not exist yet, we can mock or try to list from traces
    // For now, let's just use the user's workspace if available, or fetch unique workspaces from traces
    const res = await fetch(`/ops/api/traces?tenant_id=${currentTenantId()}&limit=100`, { headers: headers() });
    const data = await res.json();
    const workspaces = new Set(data.traces.map(t => t.workspace_id).filter(Boolean));
    
    // Add options
    const current = globalWorkspaceSelect.value;
    globalWorkspaceSelect.innerHTML = `<option value="">All Workspaces</option>`;
    workspaces.forEach(ws => {
      const opt = document.createElement("option");
      opt.value = ws;
      opt.textContent = ws;
      globalWorkspaceSelect.appendChild(opt);
    });
    
    if (state.user?.workspace_id && workspaces.has(state.user.workspace_id)) {
        globalWorkspaceSelect.value = state.user.workspace_id;
    } else {
        globalWorkspaceSelect.value = current;
    }
  } catch (e) {
    console.warn("Failed to load workspaces list", e);
  }
}

// --- Tooltip System ---
function initTooltips() {
  let activeTooltip = null;
  let activeTarget = null;

  document.body.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-tooltip]");
    if (!target) {
      if (activeTooltip) hideTooltip();
      return;
    }
    if (target === activeTarget) return;
    
    showTooltip(target);
  });

  document.body.addEventListener("mouseout", (e) => {
    const target = e.target.closest("[data-tooltip]");
    if (target && target === activeTarget) {
      // Check if moving into the tooltip itself (rare but possible with fixed positioning if overlapping)
      // but tooltip has pointer-events: none so it shouldn't capture mouse events.
      hideTooltip();
    }
  });
  
  // Also hide on scroll to prevent detached tooltips
  window.addEventListener("scroll", () => { if (activeTooltip) hideTooltip(); }, true);

  function showTooltip(target) {
    if (activeTooltip) hideTooltip();
    
    activeTarget = target;
    const text = target.getAttribute("data-tooltip");
    if (!text) return;

    const tooltip = document.createElement("div");
    tooltip.className = "tooltip-popup";
    tooltip.textContent = text;
    document.body.appendChild(tooltip);
    activeTooltip = tooltip;

    // Position it
    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    
    let top = rect.top - tooltipRect.height - 8;
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    
    // Boundary checks
    if (top < 0) {
       // Flip to bottom if no space on top
       top = rect.bottom + 8;
       tooltip.classList.add("bottom"); // We could add class to flip arrow if needed
    }
    if (left < 10) left = 10;
    if (left + tooltipRect.width > window.innerWidth - 10) {
      left = window.innerWidth - tooltipRect.width - 10;
    }

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    
    // Trigger animation
    requestAnimationFrame(() => tooltip.classList.add("visible"));
  }

  function hideTooltip() {
    if (!activeTooltip) return;
    const t = activeTooltip;
    activeTooltip = null;
    activeTarget = null;
    t.classList.remove("visible");
    setTimeout(() => t.remove(), 150);
  }
}

// Global workspace change handler
globalWorkspaceSelect.addEventListener("change", () => {
  // Reload current view
  const view = window.location.hash.replace("#", "") || "dashboard";
  if (viewLoaders[view]) viewLoaders[view]();
});

initTooltips();
