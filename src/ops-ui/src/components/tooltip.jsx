import { useEffect } from "preact/hooks";
import { delegate } from "tippy.js";

/**
 * Global tooltip system using Tippy.js.
 * Binds to all [data-tooltip] elements via event delegation.
 */
export function TooltipProvider() {
  useEffect(() => {
    const instance = delegate(document.body, {
      target: "[data-tooltip]",
      content(reference) {
        return reference.getAttribute("data-tooltip") || "";
      },
      theme: "clasper",
      placement: "top",
      delay: [200, 0],
      maxWidth: 320,
      allowHTML: false,
      appendTo: document.body,
      arrow: true,
      inertia: true,
    });

    return () => {
      instance.destroy();
    };
  }, []);

  return null;
}
