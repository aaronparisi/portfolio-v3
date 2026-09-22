import { useEffect, useRef, type ReactNode } from "react";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

/**
 * A pinned "room" -- while you scroll through its own tall span, its
 * content stays pinned to the viewport and pans horizontally instead of
 * scrolling away vertically, then hands scroll back to the normal page
 * once its own content has fully passed. The "journey through rooms,
 * not just down a page" feel this site's scroll was missing: most
 * sections stay a normal vertical flow, but a couple (Timeline, so far)
 * interrupt that with a real "wait, we're moving sideways now" beat.
 *
 * Built the same way this codebase already measures scroll-linked
 * progress everywhere else (rAF-throttled scroll listener +
 * getBoundingClientRect, see useScrollFraction/useStoryProgressRef) --
 * no scroll library, just this section's own progress mapped straight
 * onto a CSS transform on its track.
 */
export function HorizontalRoom({ children, roomHeightVh = 260 }: { children: ReactNode; roomHeightVh?: number }) {
  const outerRef = useRef<HTMLDivElement>(null);
  // The clipped, actually-visible viewport -- NOT the track itself.
  // The track is `w-max` (sized to fit every card with no wrapping, on
  // purpose, so it never clips its own content), which means its own
  // clientWidth is just as wide as its scrollWidth -- confirmed
  // directly (both reported identical, so maxScroll always computed as
  // 0 and the track never actually panned) when this used to measure
  // clientWidth off the track. The viewport div is the one with
  // overflow-hidden, so it's the one whose clientWidth is the real,
  // clipped visible width.
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const outer = outerRef.current;
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!outer || !viewport || !track) return;

    let ticking = false;
    function update() {
      ticking = false;
      if (!outer || !viewport || !track) return;
      const rect = outer.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const progress = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
      const maxScroll = Math.max(0, track.scrollWidth - viewport.clientWidth);
      track.style.transform = `translate3d(${-progress * maxScroll}px, 0, 0)`;
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reduced]);

  if (reduced) {
    // No scroll-jacking under reduced motion -- a plain, natively
    // horizontal-scrolling row instead (touch/trackpad/wheel all work
    // on it directly), same content, no pin.
    return (
      <div className="overflow-x-auto pb-4">
        <div className="flex w-max gap-6 px-6">{children}</div>
      </div>
    );
  }

  return (
    <div ref={outerRef} style={{ height: `${roomHeightVh}vh` }} className="relative">
      <div ref={viewportRef} className="sticky top-0 flex h-screen items-center overflow-hidden">
        <div ref={trackRef} className="flex w-max gap-6 will-change-transform">
          {children}
        </div>
      </div>
    </div>
  );
}
