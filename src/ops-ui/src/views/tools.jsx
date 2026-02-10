import { useState } from "preact/hooks";
import { HelpCircleIcon } from "../components/icons.jsx";

export function ToolsView() {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <section>
      <div class="panel">
        <div class="panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 data-tooltip="External tools authorized for agent use">Tool Registry</h3>
            <button 
              class="btn-icon" 
              onClick={() => setShowHelp(!showHelp)} 
              title="Toggle help"
              style={{ color: showHelp ? "var(--text-primary)" : "var(--text-secondary)" }}
            >
              <HelpCircleIcon width={20} strokeWidth={3} />
            </button>
          </div>
          <div class="text-secondary text-xs">0 tools</div>
        </div>

        {showHelp && (
          <div style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-subtle)" }}>
            <p class="text-secondary text-sm" style={{ lineHeight: "1.5", margin: 0 }}>
              Tools are atomic capabilities (functions, APIs, or scripts) that agents can be authorized to use. Unlike Skills which are bundles of capabilities, Tools are individual primitives. This registry shows all tools currently authorized for use within this workspace.
            </p>
          </div>
        )}

        <div class="panel-body p-0">
          <div class="list-group">
            <div class="empty-state" style={{ padding: "32px 16px" }}>
              <div class="text-xs text-secondary">No active tool authorizations.</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
