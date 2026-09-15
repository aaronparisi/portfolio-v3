import { useEffect } from "react";
import { animated, useSpring, useTrail, type SpringValue } from "@react-spring/web";
import { PhotoCard } from "./PhotoCard";
import { AnimatedEquation } from "./AnimatedEquation";
import { SpringButton } from "./SpringButton";
import { ChevronDownIcon } from "./icons";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const TRAIL_ITEMS = 4; // heading, bio, equation morph, cta row — no eyebrow

// `y` isn't a real CSS property — binding {opacity, y} straight to
// `style` (as an object) silently does nothing for the y part, since
// browsers just ignore unrecognized style keys. This turns it into an
// actual transform.
function riseStyle({ opacity, y }: { opacity: SpringValue<number>; y: SpringValue<number> }) {
  return { opacity, transform: y.to((v) => `translate3d(0, ${v}px, 0)`) };
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

  const trail = useTrail(TRAIL_ITEMS, {
    from: { opacity: 0, y: 24 },
    to: { opacity: 1, y: 0 },
    immediate: reduced,
    config: { tension: 190, friction: 22 },
  });

  const photoSpring = useSpring({
    from: { opacity: 0, y: 32, scale: 0.96 },
    to: { opacity: 1, y: 0, scale: 1 },
    delay: reduced ? 0 : 180,
    immediate: reduced,
    config: { tension: 170, friction: 22 },
  });

  return (
    <section className="relative overflow-hidden pb-24 pt-24 sm:pb-32">
      {/* The room's ambient light — the softer, wider half of the same
          lamp that focuses down onto the portrait in PhotoCard itself.
          One light source for the whole page, not a decorative gradient. */}
      <div aria-hidden="true" className="light-cone absolute inset-x-0 top-0 -z-10 h-[36rem] opacity-60" />

      <div className="mx-auto grid max-w-5xl gap-16 px-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-8">
        <div className="text-center lg:text-left">
          <animated.h1
            style={riseStyle(trail[0])}
            className="font-display text-5xl leading-[1.05] tracking-tight text-[var(--ink)] sm:text-7xl"
          >
            Aaron <em className="not-italic text-[var(--accent)]">Parisi</em>
          </animated.h1>

          <animated.p
            style={riseStyle(trail[1])}
            className="mx-auto mt-6 max-w-md text-lg leading-relaxed text-[var(--ink-soft)] lg:mx-0"
          >
            Frontend developer, formerly an AP Calculus teacher. I build interfaces with React,
            TypeScript, and a habit of digging one layer deeper.
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
          style={{
            opacity: photoSpring.opacity,
            scale: photoSpring.scale,
            transform: photoSpring.y.to((v) => `translate3d(0, ${v}px, 0)`),
          }}
        >
          <PhotoCard />
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
