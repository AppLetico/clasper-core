const POLICY_PROMOTION_TOOLTIP =
  "Policy promotion manages how governance rules move across environments (for example, dev → prod) with shared authority and auditability. Clasper Core supports local policy editing and testing within a single workspace. Managed promotion, rollback workflows, and audited policy pipelines are provided by Clasper Cloud.";

export function DeploymentsView() {
  return (
    <section>
      <div class="panel">
        <div class="panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 data-tooltip={POLICY_PROMOTION_TOOLTIP}>Policy Promotion</h3>
          </div>
          <span class="badge-pill muted">Cloud</span>
        </div>

        <div class="panel-body">
          <p class="text-secondary text-sm" style={{ margin: 0 }}>
            Clasper Core: local editing and testing. Clasper Cloud: managed promotion and audited policy pipelines.
          </p>
        </div>
      </div>
    </section>
  );
}
