import { useEffect } from "react";

/**
 * Publishes the current scroll position as `--scroll-y` on the document
 * element, throttled to one write per animation frame. CSS reads it to
 * drive the parallax layers, so React never re-renders on scroll.
 *
 * Whether that movement is actually visible is decided in CSS by the
 * `[data-motion]` attribute (see MotionToggle), not here — this hook just
 * keeps the value fresh so toggling motion back on is instant.
 */
export function useScrollProgress() {
  useEffect(() => {
    const root = document.documentElement;
    let ticking = false;

    const write = () => {
      root.style.setProperty("--scroll-y", String(window.scrollY));
      ticking = false;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(write);
    };

    write();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
}
