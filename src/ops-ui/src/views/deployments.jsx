import { LayersIcon } from "../components/icons.jsx";

export function DeploymentsView() {
  return (
    <section>
      <div class="panel">
        <div class="panel-header">
          <div class="flex items-center gap-3">
            <div class="stat-icon primary"><LayersIcon /></div>
            <div>
              <h3>Policy & environment deployments</h3>
              <p class="text-tertiary text-xs">Promoting and rolling back governance policy across environments is Cloud-only.</p>
            </div>
          </div>
          <div class="badge-pill">Cloud</div>
        </div>
        <div class="panel-body">
          <p class="text-secondary text-sm">
            Clasper Core does not support promoting policy between environments, rollback workflows, or audited policy pipelines.
            Use Clasper Cloud for managed policy promotion across environments (e.g. dev → prod) with shared authority.
          </p>
        </div>
      </div>
    </section>
  );
}
