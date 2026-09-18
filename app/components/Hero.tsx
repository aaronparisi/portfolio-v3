import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { animated, to, useSpring, useTrail, type SpringValue } from "@react-spring/web";
import { ScrollSurface3D } from "./ScrollSurface3D";
import { AnimatedEquation } from "./AnimatedEquation";
import { SpringButton } from "./SpringButton";
import { ChevronDownIcon } from "./icons";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

// The reveal is a choreographed sequence, not a simultaneous cascade,
// and every delay below is measured from the moment the 3D surface
// finishes booting up (ScrollSurface3D's own onBootComplete) rather
// than from mount -- so retuning the boot sequence's own timing can
// never quietly desync the rest of this from what's actually on
// screen. Order: the surface boots alone, then the equation gets its
// own featured beat, then the surface makes room and the heading/bio/
// CTA text arrives, then Nav (its own delay lives in Nav.tsx, tuned
// against this sequence's total length), then the scroll cue last.
const EQUATION_DELAY = 300;
const SURFACE_SETTLE_DELAY = 1500;
const TEXT_DELAY = 1700;
const CARET_DELAY = 3400;

// `y` isn't a real CSS property — binding {opacity, y} straight to
// `style` (as an object) silently does nothing for the y part, since
// browsers just ignore unrecognized style keys. This turns it into an
// actual transform.
function riseStyle({ opacity, y }: { opacity: SpringValue<number>; y: SpringValue<number> }) {
  return {
    opacity,
    transform: y.to((v) => `translate3d(0, ${v}px, 0)`),
    // Elements sit invisible in the DOM for a couple of seconds during
    // the reveal rather than being unmounted, so nothing reflows when
    // they arrive -- but that means they're real, focusable, clickable
    // elements the whole time unless this is here.
    pointerEvents: opacity.to((o) => (o < 0.05 ? "none" : "auto")),
  };
}

export function Hero() {
  const reduced = usePrefersReducedMotion();
  const [booted, setBooted] = useState(false);

  // A gentle, physics-driven bob for the scroll cue — real spring settling
  // rather than Tailwind's animate-bounce, whose elastic keyframe is a
  // dated, mechanical-looking loop, not an object actually decelerating.
  const [chevron, chevronApi] = useSpring(() => ({ y: 0 }));
  useEffect(() => {
    if (reduced) return;
    void chevronApi.start({
      to: async (next) => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await next({ y: 6, config: { tension: 120, friction: 14 } });
          await next({ y: 0, config: { tension: 170, friction: 20 } });
        }
      },
    });
    return () => {
      chevronApi.stop();
    };
  }, [reduced, chevronApi]);

  // The scroll cue's own one-time entrance (separate from its
  // continuous bob above) -- last in the reveal order, after Nav.
  const [caretEntrance, caretEntranceApi] = useSpring(() => ({ opacity: 0, y: 10 }));

  // The equation gets its own featured beat, ahead of the rest of the
  // text column -- pulled out of what used to be a single four-item
  // useTrail so it can arrive on its own, distinct delay rather than as
  // just the third item in one simultaneous-ish cascade.
  const [equation, equationApi] = useSpring(() => ({ opacity: 0, y: 24, scale: 0.92 }));

  // Heading, bio, and the CTA row -- three items now, not four; the
  // equation above owns its own timing instead of sharing this trail.
  const [trail, trailApi] = useTrail(3, () => ({ opacity: 0, y: 24 }));

  useEffect(() => {
    if (reduced) {
      equationApi.set({ opacity: 1, y: 0, scale: 1 });
      trailApi.set({ opacity: 1, y: 0 });
      caretEntranceApi.set({ opacity: 1, y: 0 });
      return;
    }
    if (!booted) return;
    void equationApi.start({ opacity: 1, y: 0, scale: 1, delay: EQUATION_DELAY, config: { tension: 200, friction: 22 } });
    void trailApi.start({ opacity: 1, y: 0, delay: TEXT_DELAY, config: { tension: 190, friction: 22 } });
    void caretEntranceApi.start({ opacity: 1, y: 0, delay: CARET_DELAY, config: { tension: 210, friction: 20 } });
  }, [booted, reduced, equationApi, trailApi, caretEntranceApi]);

  // The 3D surface's own iris-like staging: pops up large and centered
  // for its boot + the equation's featured beat, then springs back into
  // its actual slot in the grid once the rest of the text arrives --
  // reading as the text physically pushing it aside, even though
  // nothing here is really pushing anything. A fixed pixel offset could
  // never span every viewport width the way a value measured from the
  // real DOM does.
  const surfaceWrapRef = useRef<HTMLDivElement>(null);
  const [centerStage, centerStageApi] = useSpring(() => ({ x: 0, y: 0, scale: 1 }));
  // Caches the one real measurement so a second effect run never
  // re-measures -- React 18 StrictMode double-invokes effects in dev
  // (mount, run, cleanup, run again), and by the second run the DOM
  // already reflects the first run's .set() (confirmed by logging: the
  // second run measured dx/dy of ~0, since the element was already
  // sitting centered) -- re-measuring then would compute a near-zero
  // offset and silently cancel the whole effect. Caching the first,
  // correct measurement and reusing it makes every run idempotent
  // regardless of how many times it fires.
  const measuredRef = useRef<{ dx: number; dy: number } | null>(null);

  useLayoutEffect(() => {
    const el = surfaceWrapRef.current;
    if (!el) return;
    if (reduced) {
      // usePrefersReducedMotion defaults to false until its own (plain
      // useEffect) check resolves -- this layout effect runs first, in
      // the same commit, so on a reduced-motion visitor it can fire once
      // believing motion isn't reduced, measure, and center the surface
      // before the real value arrives a moment later. Without this
      // branch, the dependency change to `reduced: true` just hits the
      // early return below and leaves that incorrect transform in
      // place forever.
      centerStageApi.set({ x: 0, y: 0, scale: 1 });
      return;
    }

    if (!measuredRef.current) {
      // Centered on this *section's* own box, not the raw viewport --
      // the section clips its own content (overflow-hidden, so the
      // light cones above don't bleed into About below it), so a point
      // measured against the section can never end up scaled/
      // translated somewhere that box then clips off. On a typical
      // hero-height section that's indistinguishable from "the middle
      // of the screen" anyway.
      const bounds = el.closest("section")?.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      measuredRef.current = {
        dx: (bounds ? bounds.left + bounds.width / 2 : window.innerWidth / 2) - (rect.left + rect.width / 2),
        dy: (bounds ? bounds.top + bounds.height / 2 : window.innerHeight / 2) - (rect.top + rect.height / 2),
      };
    }

    // .set(), not .start() -- this has to be in place for the very first
    // paint after hydration, not animate there, or the surface visibly
    // flashes at its resting position for a frame before jumping to
    // center.
    const { dx, dy } = measuredRef.current;
    centerStageApi.set({ x: dx, y: dy, scale: 1.3 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  useEffect(() => {
    if (reduced || !booted) return;
    const timer = window.setTimeout(() => {
      void centerStageApi.start({ x: 0, y: 0, scale: 1, config: { tension: 150, friction: 20 } });
    }, SURFACE_SETTLE_DELAY);
    return () => window.clearTimeout(timer);
  }, [booted, reduced, centerStageApi]);

  return (
    <section className="relative overflow-hidden pb-24 pt-24 sm:pb-32">
      {/* The room's ambient light — soft, wide, centered on the whole
          section. On its own it barely reaches the surface (which sits
          off to the right), so a second, stronger cone below is anchored
          the same way -- flush with the nav, top-0 of this section -- but
          shifted right and sized to actually be bright where the surface
          is. Two boxes sharing one anchor point read as one lamp; a cone
          anchored to the surface's own (vertically-centered) box instead
          does not, since nothing then connects it to the nav above. */}
      <div aria-hidden="true" className="light-cone absolute inset-x-0 top-0 -z-10 h-[36rem] opacity-60" />
      <div
        aria-hidden="true"
        className="absolute right-0 top-0 -z-10 h-[42rem] w-[46rem] max-w-[85%] opacity-45"
      >
        <div className="light-cone lamp-flicker h-full w-full" />
      </div>

      <div className="mx-auto grid max-w-5xl gap-16 px-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-8">
        <div className="text-center lg:text-left">
          <animated.div
            style={{
              opacity: equation.opacity,
              transform: to([equation.y, equation.scale], (y, s) => `translate3d(0, ${y}px, 0) scale(${s})`),
              pointerEvents: equation.opacity.to((o) => (o < 0.05 ? "none" : "auto")),
            }}
            className="mb-8 flex justify-center lg:justify-start"
          >
            <AnimatedEquation />
          </animated.div>

          <animated.h1
            style={riseStyle(trail[0])}
            className="font-display text-5xl leading-[1.05] tracking-tight text-[var(--ink)] sm:text-7xl"
          >
            Aaron{" "}
            <em className="font-hand not-italic tracking-normal text-[var(--accent)]">Parisi</em>
          </animated.h1>

          <animated.p
            style={riseStyle(trail[1])}
            className="mx-auto mt-6 max-w-md text-lg leading-relaxed text-[var(--ink-soft)] lg:mx-0"
          >
            AP Calculus teacher turned Frontend Developer. I build interfaces with React,
            TypeScript, and a habit of digging one layer deeper. The type of kid who kept
            asking, <span className="annotation text-xl">Why?</span>
          </animated.p>

          <animated.div
            style={riseStyle(trail[2])}
            className="mt-8 flex flex-wrap items-center justify-center gap-4 lg:justify-start"
          >
            <SpringButton href="#journey" className="btn-primary rounded-full px-6 py-3 font-medium">
              See my journey
            </SpringButton>
            <SpringButton href="#contact" className="btn-secondary rounded-full px-6 py-3 font-medium">
              Get in touch
            </SpringButton>
          </animated.div>
        </div>

        <animated.div
          ref={surfaceWrapRef}
          className="mx-auto aspect-square w-full max-w-[26rem]"
          style={{
            transform: to(
              [centerStage.x, centerStage.y, centerStage.scale],
              (x, y, s) => `translate3d(${x}px, ${y}px, 0) scale(${s})`,
            ),
          }}
        >
          <ScrollSurface3D onBootComplete={() => setBooted(true)} />
        </animated.div>
      </div>

      <a
        href="#about"
        aria-label="Scroll down"
        className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)] sm:block"
      >
        <animated.span
          className="block"
          style={{
            opacity: caretEntrance.opacity,
            transform: to(
              [caretEntrance.y, chevron.y],
              (entranceY, bobY) => `translate3d(0, ${entranceY + bobY}px, 0)`,
            ),
          }}
        >
          <ChevronDownIcon className="h-5 w-5" />
        </animated.span>
      </a>
    </section>
  );
}
