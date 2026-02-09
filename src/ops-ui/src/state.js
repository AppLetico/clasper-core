import { signal, computed, effect } from "@preact/signals";

// --- Auth ---
export const token = signal(localStorage.getItem("clasper_ops_token") || "");
export const user = signal(null);
export const permissions = signal([]);

// Persist token to localStorage
effect(() => {
  const t = token.value;
  if (t) localStorage.setItem("clasper_ops_token", t);
  else localStorage.removeItem("clasper_ops_token");
});

export const authHeaders = computed(() =>
  token.value ? { "X-Ops-Api-Key": token.value } : {}
);

export const tenantId = computed(() => user.value?.tenant_id || "");

export function hasPermission(p) {
  return permissions.value.includes(p);
}

// --- Global Context ---
export const selectedWorkspace = signal("");
function parseHash() {
  const raw = (location.hash || "#dashboard").replace("#", "") || "dashboard";
  const [route, query] = raw.includes("?") ? raw.split("?") : [raw, ""];
  return { route: route || "dashboard", query };
}

export const currentRoute = signal(parseHash().route);
/** Query string from hash (e.g. "risk_level=high" when hash is #traces?risk_level=high) */
export const routeQuery = signal(parseHash().query);

// Sync hash changes into signals
function syncHash() {
  const { route, query } = parseHash();
  currentRoute.value = route;
  routeQuery.value = query;
}
window.addEventListener("hashchange", syncHash);

// --- Toasts ---
let toastId = 0;
export const toasts = signal([]);

export function showToast(message, type = "info") {
  const id = ++toastId;
  toasts.value = [...toasts.value, { id, message, type }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, 3200);
}

// --- Health ---
export const healthStatus = signal({ ok: null, text: "Checking...", components: {} });

// --- Modals ---
export const authModalOpen = signal(false);
export const overrideModal = signal({ open: false, callback: null, message: "" });
export const confirmModal = signal({ open: false, title: "", message: "", callback: null });

// --- Helpers ---
export function formatCost(cost) {
  if (cost === undefined || cost === null || Number.isNaN(Number(cost))) return "-";
  const num = Number(cost);
  if (num === 0) return "$0.00";
  if (num < 0.01) return `$${num.toFixed(4)}`;
  return `$${num.toFixed(2)}`;
}
