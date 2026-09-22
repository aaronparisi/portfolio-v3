import { useEffect } from "react";
import { animated, to, useSpring, useTrail, type SpringValue } from "@react-spring/web";
import { AnimatedEquation } from "./AnimatedEquation";
import { SpringButton } from "./SpringButton";
import { ChevronDownIcon } from "./icons";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

// The reveal is a choreographed sequence, not a simultaneous cascade,
// and every delay below is measured from the moment the 3D backdrop
// finishes booting up (Experience3D's own onBootComplete, threaded down
// from home.tsx as the `booted` prop) rather than from mount -- so
// retuning the boot sequence's own timing can never quietly desync the
// rest of this from what's actually on screen. Order: the backdrop
// boots alone, then the equation gets its own featured beat, then the
// heading/bio/CTA text arrives, then Nav (its own delay lives in
// Nav.tsx, tuned against this sequence's total length), then the
// scroll cue last. There's no local surface to spring back into a grid
// slot anymore -- the 3D layer is a fixed, page-wide backdrop now (see
// Experience3D.tsx), not something mounted inside this section, so this
// file only ever owns the text's own entrance.
const EQUATION_DELAY = 300;
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

export function Hero({ booted }: { booted: boolean }) {
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

  return (
    <section className="relative flex min-h-[85vh] flex-col justify-center overflow-hidden pb-24 pt-24 sm:pb-32 sm:pt-32">
      {/* The room's ambient light — soft, wide, centered on the whole
          section. The 3D backdrop's own glow now does most of the actual
          "light source" work behind the text; this keeps the same warm
          cast over the page's own background regardless of where the
          object has scrolled/rotated to. */}
      <div aria-hidden="true" className="light-cone absolute inset-x-0 top-0 -z-10 h-[36rem] opacity-60" />

      {/* The 3D backdrop's camera swings the object RIGHT through Hero
          (Experience3D.tsx's own CAMERA_KEYFRAMES) -- this column sits
          left, on large viewports, to match, with its own high-opacity
          panel underneath as a legibility floor regardless of exactly
          where the object ends up on screen. No backdrop-blur --
          confirmed directly that blurring a live WebGL canvas through
          backdrop-filter renders as a distorted ghost/double-image
          rather than clean frosted glass; a near-solid background reads
          just as clean without it. */}
      <div className="mx-auto max-w-2xl px-6 lg:mx-0 lg:ml-[7%] lg:max-w-xl">
        <div className="rounded-3xl bg-[var(--bg)]/92 p-6 text-center sm:p-10 lg:text-left">
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
