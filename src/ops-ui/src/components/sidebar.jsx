import { useState, useEffect } from "preact/hooks";
import { currentRoute, selectedWorkspace, tenantId, user, authModalOpen } from "../state.js";
import { fetchWorkspaces, signOut, api, buildParams } from "../api.js";
import { DashboardIcon, SearchIcon, LayersIcon, DollarIcon, BoltIcon, GearIcon, ShieldIcon, ThumbsUpIcon, FileIcon, UserIcon, LockIcon, LogOutIcon, ChevronDownIcon, WrenchIcon } from "./icons.jsx";

const NAV = [
  { group: "Platform", items: [
    { id: "dashboard", label: "Dashboard", icon: DashboardIcon },
    { id: "traces", label: "Traces", icon: SearchIcon },
    { id: "deployments", label: "Deployments", icon: LayersIcon },
    { id: "cost", label: "Cost", icon: DollarIcon },
  ]},
  { group: "Registry", items: [
    { id: "skills", label: "Skills", icon: BoltIcon },
    { id: "tools", label: "Tools", icon: WrenchIcon },
    { id: "adapters", label: "Adapters", icon: GearIcon },
  ]},
  { group: "Governance", items: [
    { id: "policies", label: "Policies", icon: ShieldIcon },
    { id: "approvals", label: "Approvals", icon: ThumbsUpIcon },
    { id: "audit", label: "Audit", icon: FileIcon },
  ]},
];

export function Sidebar() {
  const [workspaces, setWorkspaces] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    fetchWorkspaces().then(setWorkspaces);
  }, [user.value?.tenant_id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api(`/ops/api/decisions?${buildParams({ status: "pending" })}`);
        const c = data.decisions?.length ?? 0;
        if (!cancelled) setPendingApprovals(c);
      } catch {
        if (!cancelled) setPendingApprovals(0);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId.value, selectedWorkspace.value]);

  const navigate = (id) => {
    location.hash = `#${id}`;
    // Signal updates via hashchange listener in state.js
  };

  return (
    <aside class="sidebar">
      <a href="#dashboard" class="brand-block" aria-label="Clasper Core Ops Console home" onClick={(e) => { e.preventDefault(); navigate("dashboard"); }}>
        <div class="brand-logo brand-logo-box">
          <img src="/ops/logo.svg?v=4" alt="" class="brand-logo-img" width="24" height="24" fetchpriority="high" />
        </div>
        <div class="brand-text">
          <div class="brand-name">Clasper Core</div>
          <div class="brand-subtitle">Ops Console</div>
        </div>
      </a>

      <div class="workspace-selector-container">
        <select class="workspace-select" value={selectedWorkspace.value} onChange={(e) => { selectedWorkspace.value = e.target.value; }}>
          <option value="">All Workspaces</option>
          {workspaces.map((ws) => <option key={ws} value={ws}>{ws}</option>)}
        </select>
      </div>

      <nav class="nav">
        {NAV.map(({ group, items }) => (
          <div key={group}>
            <div class="nav-group-label">{group}</div>
            {items.map(({ id, label, icon: Icon }) => (
              <a key={id} class={`nav-link ${currentRoute.value === id ? "active" : ""}`} href={`#${id}`} data-nav={id} onClick={(e) => { e.preventDefault(); navigate(id); }}>
                <Icon class="nav-icon" />
                {label}
                {id === "approvals" && pendingApprovals > 0 && (
                  <span class="nav-badge">{pendingApprovals}</span>
                )}
              </a>
            ))}
          </div>
        ))}
      </nav>

      <div class="sidebar-footer">
        <div class="user-menu-container">
          <button class={`user-block ${menuOpen ? "active" : ""}`} onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}>
            <div class="user-avatar"><UserIcon /></div>
            <div class="user-info">
              <div class="user-role">{user.value ? user.value.id : "Not authenticated"}</div>
              <div class="user-subtext">Click for options</div>
            </div>
            <ChevronDownIcon class="user-chevron" />
          </button>

          {menuOpen && (
            <UserDropdown onClose={() => setMenuOpen(false)} />
          )}
        </div>
      </div>
    </aside>
  );
}

function UserDropdown({ onClose }) {
  useEffect(() => {
    const handler = () => onClose();
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  return (
    <div class="user-dropdown" onClick={(e) => e.stopPropagation()}>
      <button class="menu-item" onClick={() => { authModalOpen.value = true; onClose(); }}>
        <LockIcon /> Enter Token
      </button>
      <button class="menu-item" onClick={() => { currentRoute.value = "settings"; location.hash = "settings"; onClose(); }}>
        <GearIcon /> Settings
      </button>
      <div class="menu-divider" />
      <button class="menu-item text-danger" onClick={() => { signOut(); onClose(); }}>
        <LogOutIcon /> Sign Out
      </button>
    </div>
  );
}
