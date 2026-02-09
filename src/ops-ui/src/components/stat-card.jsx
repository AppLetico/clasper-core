export function StatCard({ icon, variant = "info", label, tooltip, value, meta, children, href }) {
  const labelEl = (
    <div class="stat-label" {...(!href && { "data-tooltip": tooltip })}>{label}</div>
  );
  const content = (
    <>
      <div class={`stat-icon ${variant}`}>{icon}</div>
      <div class="stat-content">
        {labelEl}
        <div class="stat-value">{value}</div>
        {meta && <div class="stat-meta">{meta}</div>}
        {children}
      </div>
    </>
  );
  if (href) {
    return (
      <a class="stat-card stat-card--link" href={href} data-tooltip={tooltip}>
        {content}
      </a>
    );
  }
  return <div class="stat-card">{content}</div>;
}
