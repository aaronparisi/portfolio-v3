import { useEffect, useLayoutEffect, useRef } from "react";
import { animated, to, useSpring, useTrail, type SpringValue } from "@react-spring/web";
import { PhotoCard } from "./PhotoCard";
import { AnimatedEquation } from "./AnimatedEquation";
import { SpringButton } from "./SpringButton";
import { ChevronDownIcon } from "./icons";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const TRAIL_ITEMS = 4; // heading, bio, equation morph, cta row — no eyebrow

// The reveal is a choreographed sequence, not a simultaneous cascade:
// the photo gets its own moment center-stage (pop in, then a "peek" of
// its hover-wipe effect) before the nav or text exist at all (Nav.tsx's
// own entrance delay is tuned against this same number — change one,
// sanity-check the other), and only once that's played out does the
// text column arrive and visibly push the photo back to its resting
// spot in the grid.
const PUSH_DELAY = 2700;
const PHOTO_PEEK_DELAY = 850;

// `y` isn't a real CSS property — binding {opacity, y} straight to
// `style` (as an object) silently does nothing for the y part, since
// browsers just ignore unrecognized style keys. This turns it into an
// actual transform.
function riseStyle({ opacity, y }: { opacity: SpringValue<number>; y: SpringValue<number> }) {
  return {
    opacity,
    transform: y.to((v) => `translate3d(0, ${v}px, 0)`),
    // The text column sits invisible in the DOM for a couple of seconds
    // during the reveal (PUSH_DELAY) rather than being unmounted, so
    // nothing reflows when it arrives -- but that means its buttons and
    // links are real, focusable, clickable elements the whole time
    // unless this is here.
    pointerEvents: opacity.to((o) => (o < 0.05 ? "none" : "auto")),
  };
}

export function Hero() {
  const reduced = usePrefersReducedMotion();

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

  // The text column waits for the photo's solo moment (pop + peek) and
  // the nav's own drop-in to finish before it arrives -- see PUSH_DELAY.
  const trail = useTrail(TRAIL_ITEMS, {
    from: { opacity: 0, y: 24 },
    to: { opacity: 1, y: 0 },
    delay: reduced ? 0 : PUSH_DELAY,
    immediate: reduced,
    config: { tension: 190, friction: 22 },
  });

  // The photo's own iris-pop entrance lives inside PhotoCard.tsx now
  // (see its `entrance` spring) -- this is a second, outer transform on
  // top of that: measured against the photo's real resting position in
  // the grid (the text column sits there invisibly the whole time, not
  // unmounted, so nothing reflows) so the photo can appear centered in
  // the viewport at a dramatically larger size, hold there for its own
  // beat, then spring back into its actual slot exactly as the text
  // column arrives -- reading as the text physically pushing it aside,
  // even though nothing here is really pushing anything. A fixed pixel
  // offset could never span every viewport width the way a value
  // measured from the real DOM does.
  const photoWrapRef = useRef<HTMLDivElement>(null);
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
    const el = photoWrapRef.current;
    if (!el) return;
    if (reduced) {
      // usePrefersReducedMotion defaults to false until its own (plain
      // useEffect) check resolves -- this layout effect runs first, in
      // the same commit, so on a reduced-motion visitor it can fire once
      // believing motion isn't reduced, measure, and center the photo
      // before the real value arrives a moment later. Without this
      // branch, the dependency change to `reduced: true` just hits the
      // early return below and leaves that incorrect transform in
      // place forever -- confirmed by measuring the rendered photo:
      // stuck at the centered, 1.3x-scaled position, never its resting
      // size. Explicitly resetting to identity here undoes that.
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
    // paint after hydration, not animate there, or the photo visibly
    // flashes at its resting position for a frame before jumping to
    // center.
    const { dx, dy } = measuredRef.current;
    centerStageApi.set({ x: dx, y: dy, scale: 1.3 });

    const timer = window.setTimeout(() => {
      void centerStageApi.start({ x: 0, y: 0, scale: 1, config: { tension: 150, friction: 20 } });
    }, PUSH_DELAY);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return (
    <section className="relative overflow-hidden pb-24 pt-24 sm:pb-32">
      {/* The room's ambient light — soft, wide, centered on the whole
          section. On its own it barely reaches the portrait (which sits
          off to the right), so a second, stronger cone below is anchored
          the same way -- flush with the nav, top-0 of this section -- but
          shifted right and sized to actually be bright where the portrait
          is. Two boxes sharing one anchor point read as one lamp; a cone
          anchored to the portrait's own (vertically-centered) box instead
          does not, since nothing then connects it to the nav above. */}
      {/* Gruvbox-theme experiment: this cone's intensity was tuned against
          the Overhead Projector world's --accent (#e8bc78, a soft amber) --
          Gruvbox's --accent (#fabd2f) is a much more saturated, punchier
          yellow, so the identical intensity read as an actual light source
          obscuring the face instead of a warm suggestion of one. Turns out
          it was never actually at opacity-90 in the first place: an
          opacity utility and the lamp-flicker animation on the SAME
          element don't compose -- lamp-flicker's keyframes hardcode
          opacity 1 and 0.94, which fully overrides whatever static
          opacity is also declared on that element for as long as the
          (infinite) animation runs, so this sat at ~0.94-1 the whole time
          regardless of the utility class. Split across two nested
          elements instead: opacity on the outer sets the real base
          intensity, lamp-flicker on the inner multiplies its own 1/0.94
          on top of that (opacity compounds across nesting), so both
          actually apply. */}
      <div aria-hidden="true" className="light-cone absolute inset-x-0 top-0 -z-10 h-[36rem] opacity-60" />
      <div
        aria-hidden="true"
        className="absolute right-0 top-0 -z-10 h-[42rem] w-[46rem] max-w-[85%] opacity-45"
      >
        <div className="light-cone lamp-flicker h-full w-full" />
      </div>

      <div className="mx-auto grid max-w-5xl gap-16 px-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-8">
        <div className="text-center lg:text-left">
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

          <animated.div style={riseStyle(trail[2])} className="mt-8 flex justify-center lg:justify-start">
            <AnimatedEquation />
          </animated.div>

          <animated.div
            style={riseStyle(trail[3])}
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
          ref={photoWrapRef}
          style={{
            transform: to(
              [centerStage.x, centerStage.y, centerStage.scale],
              (x, y, s) => `translate3d(${x}px, ${y}px, 0) scale(${s})`,
            ),
          }}
        >
          <PhotoCard peekDelayMs={reduced ? 5000 : PHOTO_PEEK_DELAY} />
        </animated.div>
      </div>

      <a
        href="#about"
        aria-label="Scroll down"
        className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)] sm:block"
      >
        <animated.span
          className="block"
          style={{ transform: chevron.y.to((y) => `translate3d(0, ${y}px, 0)`) }}
        >
          <ChevronDownIcon className="h-5 w-5" />
        </animated.span>
      </a>
    </section>
  );
}
