import { useEffect, useRef, type RefObject } from "react";

/**
 * How far the visitor has scrolled through a given container, as a 0-1
 * fraction of "container's own top reaching the viewport top" (0) to
 * "container's own bottom reaching the viewport bottom" (1) -- the
 * whole span from the container first scrolling into place through it
 * scrolling entirely past. Same rAF-throttled read pattern as
 * useScrollFraction, but writes into a plain ref instead of React
 * state: Experience3D's own render loop already runs independent of
 * React (a raw requestAnimationFrame loop, same as every other 3D
 * component in this codebase), and re-rendering a whole component tree
 * on every scroll frame just to hand it a number that loop already
 * polls directly would be pure overhead with no upside -- nothing here
 * needs to be reactive, it needs to be read once per animation frame.
 */
export function useStoryProgressRef(containerRef: RefObject<HTMLElement | null>) {
  const progressRef = useRef(0);

  useEffect(() => {
    let ticking = false;

    const read = () => {
      ticking = false;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      progressRef.current = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(read);
    };

    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [containerRef]);

  return progressRef;
}
