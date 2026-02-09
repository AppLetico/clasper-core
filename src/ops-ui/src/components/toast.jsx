import { toasts } from "../state.js";

export function ToastContainer() {
  const items = toasts.value;
  if (!items.length) return null;
  return (
    <div class="toast-container" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} class={`toast ${t.type || "info"}`}>{t.message}</div>
      ))}
    </div>
  );
}
