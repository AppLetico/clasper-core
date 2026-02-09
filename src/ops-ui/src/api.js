import { token, user, permissions, tenantId, selectedWorkspace, authHeaders, showToast, healthStatus } from "./state.js";

// --- Fetch Wrapper ---
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...authHeaders.value, ...opts.headers },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function apiPost(path, body) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// --- Param builder (respects global workspace + tenant) ---
export function buildParams(extra = {}) {
  const params = new URLSearchParams({ tenant_id: tenantId.value, ...extra });
  if (selectedWorkspace.value) params.set("workspace_id", selectedWorkspace.value);
  return params;
}

// --- Auth ---
export async function fetchMe() {
  try {
    const data = await api("/ops/api/me");
    user.value = data.user;
    permissions.value = data.permissions || [];
  } catch {
    user.value = null;
    permissions.value = [];
  }
}

export function signOut() {
  token.value = "";
  user.value = null;
  permissions.value = [];
}

// --- Health ---
export async function fetchHealth() {
  try {
    const res = await fetch("/health");
    const data = await res.json();
    const ok = data.status === "ok";
    healthStatus.value = {
      ok,
      text: ok ? "Systems Operational" : "System Issues Detected",
      components: data.components || {},
    };
  } catch {
    healthStatus.value = { ok: false, text: "Offline", components: {} };
  }
}

// --- Workspaces ---
export async function fetchWorkspaces() {
  try {
    const params = buildParams({ limit: 100 });
    const data = await api(`/ops/api/traces?${params}`);
    const ws = [...new Set((data.traces || []).map((t) => t.workspace_id).filter(Boolean))];

    // Auto-select user workspace if not yet selected
    if (!selectedWorkspace.value && user.value?.workspace_id && ws.includes(user.value.workspace_id)) {
      selectedWorkspace.value = user.value.workspace_id;
    }
    return ws;
  } catch {
    return [];
  }
}

// --- SSE ---
let eventSource = null;
let reconnectTimeout = null;

export function setupSSE(onEvent) {
  if (eventSource) { eventSource.close(); eventSource = null; }
  if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }

  if (!tenantId.value) return;

  const url = new URL("/ops/api/events", location.origin);
  url.searchParams.set("tenant_id", tenantId.value);
  if (token.value) url.searchParams.set("token", token.value);

  try {
    eventSource = new EventSource(url);
    eventSource.onerror = () => {
      eventSource.close();
      eventSource = null;
      reconnectTimeout = setTimeout(() => setupSSE(onEvent), 5000);
    };

    const events = ["trace.created", "trace.completed", "decision.created", "decision.resolved"];
    events.forEach((ev) => {
      eventSource.addEventListener(ev, (e) => onEvent(ev, e));
    });
  } catch (e) {
    console.error("SSE setup failed", e);
  }
}

export function teardownSSE() {
  if (eventSource) { eventSource.close(); eventSource = null; }
  if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
}
