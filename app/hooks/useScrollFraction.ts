import { useEffect, useState } from "react";

/**
 * How far down the page the visitor has scrolled, as a 0-1 fraction of
 * the total scrollable distance. Throttled to one read per animation
 * frame. Used by the top scroll-progress bar.
 */
export function useScrollFraction() {
  const [fraction, setFraction] = useState(0);

  useEffect(() => {
    let ticking = false;

    const read = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setFraction(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
      ticking = false;
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
  }, []);

  return fraction;
}
