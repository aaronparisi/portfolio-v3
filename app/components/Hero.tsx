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
