import { useEffect, useState } from "react";

/**
 * Tracks the OS-level reduced-motion preference reactively (it can
 * change while the page is open). Every spring animation in this app
 * reads this and swaps to `immediate: true` rather than skipping motion
 * via a second, independent on-page toggle.
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
