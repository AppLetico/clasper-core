import { useEffect } from "preact/hooks";
import { currentRoute, token, tenantId, selectedWorkspace, showToast } from "./state.js";
import { fetchMe, fetchHealth, setupSSE, teardownSSE, fetchWorkspaces } from "./api.js";

import { Sidebar } from "./components/sidebar.jsx";
import { Topbar } from "./components/topbar.jsx";
import { TooltipProvider } from "./components/tooltip.jsx";
import { ToastContainer } from "./components/toast.jsx";
import { AuthModal, OverrideModal, ConfirmModal } from "./components/modal.jsx";
import { TraceDrawer } from "./components/drawer.jsx";

import { DashboardView } from "./views/dashboard.jsx";
import { TracesView } from "./views/traces.jsx";
import { DeploymentsView } from "./views/deployments.jsx";
import { CostView } from "./views/cost.jsx";
import { SkillsView } from "./views/skills.jsx";
import { PoliciesView } from "./views/policies.jsx";
import { AdaptersView } from "./views/adapters.jsx";
import { ApprovalsView } from "./views/approvals.jsx";
import { AuditView } from "./views/audit.jsx";
import { SettingsView } from "./views/settings.jsx";

const VIEWS = {
  dashboard: DashboardView,
  traces: TracesView,
  deployments: DeploymentsView,
  cost: CostView,
  skills: SkillsView,
  policies: PoliciesView,
  adapters: AdaptersView,
  approvals: ApprovalsView,
  audit: AuditView,
  settings: SettingsView,
};

export function App() {
  // Bootstrap: authenticate then start SSE + load workspaces
  useEffect(() => {
    fetchMe().then(() => {
      fetchWorkspaces();
    });
  }, [token.value]);

  // SSE connection: reconnect when tenant changes
  useEffect(() => {
    const onEvent = (type) => {
      if (type === "trace.created" || type === "trace.completed") {
        // Views will refetch via their own effects when signals change
      }
      if (type === "decision.created") {
        showToast("New approval request pending", "info");
      }
    };
    setupSSE(onEvent);
    return teardownSSE;
  }, [tenantId.value]);

  // Health check on mount
  useEffect(() => { fetchHealth(); }, []);

  const route = currentRoute.value;
  const ViewComponent = VIEWS[route] || DashboardView;

  return (
    <>
      <div class="app-shell">
        <Sidebar />
        <div class="main">
          <Topbar />
          <main class="content-scroll">
            <div class="content-container">
              <ViewComponent key={route} />
            </div>
          </main>
        </div>
      </div>

      {/* Overlays */}
      <TraceDrawer />
      <ToastContainer />
      <AuthModal />
      <OverrideModal />
      <ConfirmModal />
      <TooltipProvider />
    </>
  );
}
