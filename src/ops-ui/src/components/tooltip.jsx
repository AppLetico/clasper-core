import { useEffect } from "preact/hooks";

/**
 * Global tooltip system — mounts once at app level.
 * Uses a single popup element to avoid duplicates; listens for [data-tooltip].
 */
export function TooltipProvider() {
  useEffect(() => {
    let activeTarget = null;
    let hideTimer = null;

    const el = document.createElement("div");
    el.className = "tooltip-popup";
    el.setAttribute("role", "tooltip");
    el.setAttribute("aria-hidden", "true");
    el.style.display = "none";
    document.body.appendChild(el);

    function position(target) {
      const text = target.getAttribute("data-tooltip");
      if (!text) return;
      el.textContent = text;
      el.setAttribute("aria-hidden", "false");
      el.style.display = "";

      const rect = target.getBoundingClientRect();
      const tRect = el.getBoundingClientRect();
      let top = rect.top - tRect.height - 8;
      let left = rect.left + rect.width / 2 - tRect.width / 2;
      if (top < 8) top = rect.bottom + 8;
      if (left < 10) left = 10;
      if (left + tRect.width > window.innerWidth - 10) left = window.innerWidth - tRect.width - 10;
      el.style.top = `${top}px`;
      el.style.left = `${left}px`;
      requestAnimationFrame(() => el.classList.add("visible"));
    }

    function show(target) {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      if (target === activeTarget) return;
      activeTarget = target;
      const text = target.getAttribute("data-tooltip");
      if (!text) return;
      el.classList.remove("visible");
      el.textContent = text;
      el.setAttribute("aria-hidden", "false");
      el.style.display = "";
      // Position after layout so getBoundingClientRect is correct
      requestAnimationFrame(() => {
        if (activeTarget !== target) return;
        position(target);
      });
    }

    function hide() {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideTimer = null;
        activeTarget = null;
        el.classList.remove("visible");
        el.setAttribute("aria-hidden", "true");
        el.style.display = "none";
      }, 50);
    }

    function hideImmediate() {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
      activeTarget = null;
      el.classList.remove("visible");
      el.setAttribute("aria-hidden", "true");
      el.style.display = "none";
    }

    const onOver = (e) => {
      const t = e.target.closest("[data-tooltip]");
      if (!t) {
        hide();
        return;
      }
      show(t);
    };

    const onOut = (e) => {
      const t = e.target.closest("[data-tooltip]");
      if (t && t === activeTarget) hide();
    };

    const onScroll = () => hideImmediate();

    document.body.addEventListener("mouseover", onOver, true);
    document.body.addEventListener("mouseout", onOut, true);
    window.addEventListener("scroll", onScroll, true);

    return () => {
      hideImmediate();
      el.remove();
      document.body.removeEventListener("mouseover", onOver, true);
      document.body.removeEventListener("mouseout", onOut, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  return null;
}
