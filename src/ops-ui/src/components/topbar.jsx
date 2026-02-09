import { currentRoute, healthStatus } from "../state.js";

export function Topbar() {
  const route = currentRoute.value;
  const health = healthStatus.value;
  const label = route.charAt(0).toUpperCase() + route.slice(1);

  const dotColor = health.ok === null ? "var(--text-tertiary)" : health.ok ? "#10b981" : "#ef4444";

  return (
    <header class="topbar">
      <div class="topbar-content">
        <div class="breadcrumbs">
          <span class="breadcrumb-root">Clasper Core</span>
          <span class="breadcrumb-sep">/</span>
          <h1 class="breadcrumb-current">{label}</h1>
        </div>
        <div class="topbar-actions">
          <div class="health-badge">
            <span class="health-dot" style={{ background: dotColor }} />
            <span>{health.text}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
