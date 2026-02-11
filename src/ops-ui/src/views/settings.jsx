import { useState, useEffect } from "preact/hooks";
import { showToast, user, token } from "../state.js";
import { api } from "../api.js";
import {
  GearIcon,
  ShieldIcon,
  ActivityIcon,
  LockIcon,
  BoltIcon,
  UserIcon,
  RefreshIcon,
} from "../components/icons.jsx";

// --- Persisted settings (localStorage) ---
const DEFAULTS = {
  theme: "system", // light, dark, system
  autoRefreshInterval: "30",
  defaultPageSize: "50",
  toastDuration: "3",
  sseReconnectDelay: "5",
  requestTimeout: "10",
  costAlertThreshold: "10.00",
  riskAlertLevel: "high",
  traceRetentionDays: "90",
  defaultEnvironment: "",
  enableDesktopNotifications: false,
  enableSoundAlerts: false,
  compactMode: false,
};

const CONFORMANCE_COMMAND = "CONTROL_PLANE_URL=<backend-url> AGENT_TOKEN=<workspace-token> npm run conformance";
const CONFORMANCE_DOCS_URL = "https://clasper.ai/docs/integration/#conformance-testing-control-plane";

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("clasper_ops_settings") || "{}");
    return { ...DEFAULTS, ...saved };
  } catch { return { ...DEFAULTS }; }
}

function saveSettings(settings) {
  localStorage.setItem("clasper_ops_settings", JSON.stringify(settings));
  applyTheme(settings.theme);
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.setAttribute("data-theme", "dark");
  } else if (theme === "light") {
    root.setAttribute("data-theme", "light");
  } else {
    // System
    root.removeAttribute("data-theme");
  }
}

// Apply theme on initial load
const initialSettings = loadSettings();
applyTheme(initialSettings.theme);

async function copyToClipboard(text) {
  // Prefer async clipboard API when available
  if (globalThis?.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(text);
    return;
  }

  // Fallback for older browsers / restricted contexts
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "absolute";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

export function SettingsView() {
  const [settings, setSettings] = useState(initialSettings);
  const [serverInfo, setServerInfo] = useState(null);

  useEffect(() => {
    api("/health").then(setServerInfo).catch(() => setServerInfo(null));
  }, []);

  const update = (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings(next);
  };

  const resetAll = () => {
    setSettings({ ...DEFAULTS });
    saveSettings(DEFAULTS);
    showToast("Settings reset to defaults", "info");
  };

  const clearStorage = () => {
    const tok = token.value;
    localStorage.clear();
    if (tok) localStorage.setItem("clasper_ops_token", tok);
    showToast("Local data cleared (token preserved)", "success");
  };

  return (
    <div class="content-container">
      <div class="mb-4">
        <h2>Settings</h2>
      </div>

      <div class="section-grid" style={{ alignItems: "start" }}>
        
        {/* Left Column: Preferences */}
        <div class="flex flex-col gap-3">
          
          <UserProfile user={user.value} />

          <div class="panel">
            <div class="panel-header">
              <div class="flex items-center gap-2">
                <GearIcon width={16} class="text-secondary" />
                <h3>Console Preferences</h3>
              </div>
            </div>
            <div class="panel-body">
              <SettingRow label="Theme" tooltip="Choose your preferred appearance">
                <div class="theme-segments">
                  {["light", "system", "dark"].map(t => (
                    <button 
                      class={`theme-tab ${settings.theme === t ? "active" : ""}`}
                      onClick={() => update("theme", t)}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </SettingRow>

              <SettingRow label="Auto-Refresh Interval" tooltip="How often views automatically reload data (in seconds)">
                <select class="input-sm" value={settings.autoRefreshInterval} onChange={(e) => update("autoRefreshInterval", e.target.value)}>
                  <option value="0">Disabled</option>
                  <option value="10">10 seconds</option>
                  <option value="30">30 seconds</option>
                  <option value="60">1 minute</option>
                  <option value="300">5 minutes</option>
                </select>
              </SettingRow>

              <SettingRow label="Default Page Size" tooltip="Number of rows shown per page in tables">
                <select class="input-sm" value={settings.defaultPageSize} onChange={(e) => update("defaultPageSize", e.target.value)}>
                  <option value="25">25 rows</option>
                  <option value="50">50 rows</option>
                  <option value="100">100 rows</option>
                  <option value="200">200 rows</option>
                </select>
              </SettingRow>

              <SettingRow label="Toast Duration" tooltip="How long toast notifications stay visible">
                <select class="input-sm" value={settings.toastDuration} onChange={(e) => update("toastDuration", e.target.value)}>
                  <option value="2">2 seconds</option>
                  <option value="3">3 seconds</option>
                  <option value="5">5 seconds</option>
                  <option value="10">10 seconds</option>
                </select>
              </SettingRow>

              <SettingRow label="Compact Mode" tooltip="Reduce padding and spacing for denser information display">
                <ToggleSwitch checked={settings.compactMode} onChange={(v) => update("compactMode", v)} />
              </SettingRow>
            </div>
          </div>

          <div class="panel">
             <div class="panel-header">
              <div class="flex items-center gap-2">
                <LockIcon width={16} class="text-secondary" />
                <h3>Data & Privacy</h3>
              </div>
            </div>
            <div class="panel-body">
              <div class="text-secondary text-xs mb-4">
                These settings affect only your local browser session.
              </div>
              <div class="flex gap-2">
                <button class="btn-secondary flex-1" onClick={resetAll}>Reset Defaults</button>
                <button class="btn-danger flex-1" onClick={clearStorage}>Clear Local Data</button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: System & Network */}
        <div class="flex flex-col gap-3">
          
          <div class="panel">
            <div class="panel-header">
              <div class="flex items-center gap-2">
                <ShieldIcon width={16} class="text-secondary" />
                <h3>Governance Defaults</h3>
              </div>
            </div>
            <div class="panel-body">
              <SettingRow label="Default Environment" tooltip="Pre-fill this environment in deployment forms">
                <input class="input-sm" value={settings.defaultEnvironment} placeholder="e.g. dev" onInput={(e) => update("defaultEnvironment", e.target.value)} />
              </SettingRow>

              <SettingRow label="Cost Alert Threshold" tooltip="Show a warning badge when 7-day cost exceeds this amount">
                <div class="input-group">
                  <span class="flex items-center px-2 text-secondary bg-panel border border-r-0 rounded-l border-panel text-xs">$</span>
                  <input class="input-sm" type="number" step="0.01" min="0" value={settings.costAlertThreshold} onInput={(e) => update("costAlertThreshold", e.target.value)} style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }} />
                </div>
              </SettingRow>

              <SettingRow label="Risk Alert Level" tooltip="Minimum risk level that triggers notifications">
                <select class="input-sm" value={settings.riskAlertLevel} onChange={(e) => update("riskAlertLevel", e.target.value)}>
                  <option value="low">Low and above</option>
                  <option value="medium">Medium and above</option>
                  <option value="high">High and above</option>
                  <option value="critical">Critical only</option>
                </select>
              </SettingRow>

              <SettingRow label="Trace Retention" tooltip="Number of days to display historical traces">
                <select class="input-sm" value={settings.traceRetentionDays} onChange={(e) => update("traceRetentionDays", e.target.value)}>
                  <option value="30">30 days</option>
                  <option value="60">60 days</option>
                  <option value="90">90 days</option>
                  <option value="180">180 days</option>
                  <option value="365">1 year</option>
                </select>
              </SettingRow>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <div class="flex items-center gap-2">
                <ShieldIcon width={16} class="text-secondary" />
                <h3>API Conformance</h3>
              </div>
            </div>
            <div class="panel-body">
              <p class="text-secondary text-sm mb-2">
                Conformance checks that this control plane correctly implements the Mission Control API contract (capabilities, tasks, idempotency, messages, documents).
              </p>
              <p class="text-secondary text-sm mb-3">
                Conformance is run <strong>per workspace</strong>: use the <strong>agent token</strong> for the workspace you want to verify (not your Ops Console token).
              </p>
              <div class="flex items-center justify-between mb-2">
                <div class="text-secondary text-xs">Run from your Clasper Core project:</div>
                <button
                  type="button"
                  class="btn-secondary btn-sm"
                  onClick={async () => {
                    try {
                      await copyToClipboard(CONFORMANCE_COMMAND);
                      showToast("Copied conformance command", "success");
                    } catch {
                      showToast("Copy failed. Please copy manually.", "warn");
                    }
                  }}
                >
                  Copy
                </button>
              </div>
              <pre class="code-block mono text-xs" style={{ padding: "8px 10px", borderRadius: 6, background: "var(--bg-panel)", overflow: "auto" }}>
                {CONFORMANCE_COMMAND}
              </pre>
              <p class="text-secondary text-xs mt-2">
                Results are written to <code class="mono">./conformance-results/</code> (conformance.json and junit.xml). No conformance data is stored or displayed in this console.
              </p>
              <p class="text-secondary text-xs mt-2">
                Docs:{" "}
                <a href={CONFORMANCE_DOCS_URL} target="_blank" rel="noreferrer" style={{ color: "var(--accent-primary)", textDecoration: "none" }}>
                  Conformance testing (control plane)
                </a>
              </p>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <div class="flex items-center gap-2">
                <ActivityIcon width={16} class="text-secondary" />
                <h3>Network & API</h3>
              </div>
            </div>
            <div class="panel-body">
              <SettingRow label="Request Timeout" tooltip="Maximum time to wait for an API response">
                <select class="input-sm" value={settings.requestTimeout} onChange={(e) => update("requestTimeout", e.target.value)}>
                  <option value="5">5 seconds</option>
                  <option value="10">10 seconds</option>
                  <option value="30">30 seconds</option>
                  <option value="60">60 seconds</option>
                </select>
              </SettingRow>

              <SettingRow label="SSE Reconnect Delay" tooltip="Time to wait before reconnecting live stream">
                <select class="input-sm" value={settings.sseReconnectDelay} onChange={(e) => update("sseReconnectDelay", e.target.value)}>
                  <option value="2">2 seconds</option>
                  <option value="5">5 seconds</option>
                  <option value="10">10 seconds</option>
                  <option value="30">30 seconds</option>
                </select>
              </SettingRow>

              <SettingRow label="Desktop Notifications" tooltip="Show browser notifications for critical events">
                <ToggleSwitch checked={settings.enableDesktopNotifications} onChange={(v) => update("enableDesktopNotifications", v)} />
              </SettingRow>

              <SettingRow label="Sound Alerts" tooltip="Play a sound when critical events occur">
                <ToggleSwitch checked={settings.enableSoundAlerts} onChange={(v) => update("enableSoundAlerts", v)} />
              </SettingRow>
            </div>
          </div>

          <SystemInfo serverInfo={serverInfo} />
        </div>
      </div>
    </div>
  );
}

// --- Sections ---

function UserProfile({ user }) {
  if (!user) return null;
  return (
    <div class="panel">
      <div class="panel-body flex items-center gap-4">
        <div class="user-avatar" style={{ width: 48, height: 48, fontSize: 18, background: "var(--bg-panel-hover)" }}>
          {user.id ? user.id[0].toUpperCase() : "U"}
        </div>
        <div>
          <div class="font-bold text-lg">{user.id}</div>
          <div class="text-secondary text-xs mono">Tenant: {user.tenant_id}</div>
          <div class="flex gap-2 mt-2">
            <span class="badge-pill">Admin</span>
            <span class="badge-pill success">Active</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SystemInfo({ serverInfo }) {
  return (
    <div class="panel">
      <div class="panel-header">
        <div class="flex items-center gap-2">
          <BoltIcon width={16} class="text-secondary" />
          <h3>System Info</h3>
        </div>
      </div>
      <div class="panel-body">
        <div class="detail-row"><span class="detail-label">Console Version</span><span class="detail-val mono">v1.2.4</span></div>
        <div class="detail-row"><span class="detail-label">Server Status</span><span class="detail-val">{serverInfo?.status === "ok" ? <span class="badge-pill success">Connected</span> : <span class="badge-pill warn">Unavailable</span>}</span></div>
        <div class="detail-row"><span class="detail-label">Server Version</span><span class="detail-val mono">{serverInfo?.version || "—"}</span></div>
        <div class="detail-row"><span class="detail-label">Environment</span><span class="detail-val mono">{serverInfo?.env || "production"}</span></div>
      </div>
    </div>
  );
}

// --- Shared Components ---

function SettingRow({ label, tooltip, children }) {
  return (
    <div class="setting-row">
      <label class="setting-label flex items-center gap-1" data-tooltip={tooltip}>
        {label}
      </label>
      <div class="setting-control">{children}</div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      class={`toggle-switch ${checked ? "active" : ""}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      type="button"
    >
      <span class="toggle-thumb" />
    </button>
  );
}
