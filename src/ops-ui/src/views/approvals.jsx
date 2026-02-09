import { useEffect, useState } from "preact/hooks";
import { tenantId, selectedWorkspace } from "../state.js";
import { api, buildParams } from "../api.js";
import { PendingDecisionCard } from "../components/trace-card.jsx";

export function ApprovalsView() {
  const [decisions, setDecisions] = useState(null);

  const load = async () => {
    try {
      const data = await api(`/ops/api/decisions?${buildParams({ status: "pending" })}`);
      setDecisions(data.decisions || []);
    } catch {
      setDecisions([]);
    }
  };

  useEffect(() => { load(); }, [tenantId.value, selectedWorkspace.value]);

  return (
    <section>
      <div style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "8px", color: "var(--text-primary)" }}>Approvals</h2>
        <p class="text-secondary text-sm" style={{ lineHeight: "1.5" }}>
          Clasper Core supports local approvals for single-operator workflows. These approvals are self-attested and not externally verifiable.
          {" "}
          Clasper Cloud adds trusted approvals with organizational authority, auditability, and proof.
        </p>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h3>Pending Decisions</h3>
          <button class="btn-secondary btn-sm" onClick={load}>Refresh Queue</button>
        </div>
        <div class="panel-list">
          {decisions === null && <div class="empty-state"><div class="spinner" /></div>}
          {decisions && !decisions.length && (
            <div class="empty-state"><div class="empty-icon">✓</div><div>No pending approvals</div></div>
          )}
          {decisions && decisions.length > 0 && decisions.map((d) => (
            <PendingDecisionCard key={d.decision_id} decision={d} onResolved={load} />
          ))}
        </div>
      </div>
    </section>
  );
}
