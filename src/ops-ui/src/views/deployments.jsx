import { useState } from "preact/hooks";
import { HelpCircleIcon } from "../components/icons.jsx";

export function DeploymentsView() {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <section>
      <div class="panel">
        <div class="panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 data-tooltip="Policy promotion manages how governance rules move across environments (e.g. dev → prod) with shared authority and auditability.">Policy Promotion</h3>
            <button 
              class="btn-icon" 
              onClick={() => setShowHelp(!showHelp)} 
              title="Toggle help"
              style={{ color: showHelp ? "var(--text-primary)" : "var(--text-secondary)" }}
            >
              <HelpCircleIcon width={20} strokeWidth={3} />
            </button>
          </div>
          <span class="badge-pill muted">Cloud</span>
        </div>

        {showHelp && (
          <div style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-subtle)" }}>
            <p class="text-secondary text-sm" style={{ lineHeight: "1.5", margin: 0 }}>
              Policy promotion manages how governance rules move across environments (for example, dev → prod) with shared authority and auditability.
            </p>
            <p class="text-secondary text-sm" style={{ lineHeight: "1.5", margin: "8px 0 0 0" }}>
              Clasper Core supports local policy editing and testing within a single workspace. Managed promotion, rollback workflows, and audited policy pipelines are provided by Clasper Cloud.
            </p>
          </div>
        )}

        <div class="panel-body">
          <p class="text-secondary text-sm" style={{ margin: 0 }}>
            Clasper Core: local editing and testing. Clasper Cloud: managed promotion and audited policy pipelines.
          </p>
        </div>
      </div>
    </section>
  );
}
