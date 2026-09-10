import { useEffect, useState } from "react";

/**
 * Whether animation should be suppressed right now. Driven by the
 * `data-motion` attribute on <html> (see root.tsx's init script and
 * MotionToggle) rather than the prefers-reduced-motion media query
 * directly — data-motion already starts from that media query, but can
 * be explicitly overridden in either direction by the visitor via the
 * on-page toggle, and this hook needs to reflect that override too.
 * Every spring in this app reads this and sets `immediate: true` rather
 * than checking the OS preference a second, independent way.
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setReduced(root.getAttribute("data-motion") === "off");
    update();

    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-motion"] });
    return () => observer.disconnect();
  }, []);

  return reduced;
}
