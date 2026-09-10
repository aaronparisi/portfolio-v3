import { animated, useSpring, useTrail, type SpringValue } from "@react-spring/web";
import { PhotoCard } from "./PhotoCard";
import { AnimatedEquation } from "./AnimatedEquation";
import { SpringButton } from "./SpringButton";
import { ChevronDownIcon } from "./icons";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const TRAIL_ITEMS = 5; // eyebrow, heading, bio, equation morph, cta row

// `y` isn't a real CSS property — binding {opacity, y} straight to
// `style` (as an object) silently does nothing for the y part, since
// browsers just ignore unrecognized style keys. This turns it into an
// actual transform.
function riseStyle({ opacity, y }: { opacity: SpringValue<number>; y: SpringValue<number> }) {
  return { opacity, transform: y.to((v) => `translate3d(0, ${v}px, 0)`) };
}

export function Hero() {
  const reduced = usePrefersReducedMotion();

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
    <section className="relative overflow-hidden pb-24 pt-28 sm:pb-32 sm:pt-36">
      <div className="mx-auto grid max-w-5xl gap-16 px-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-8">
        <div className="text-center lg:text-left">
          <animated.p
            style={riseStyle(trail[0])}
            className="eyebrow mb-5 flex items-center justify-center gap-2 lg:justify-start"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
            </span>
            Frontend Developer
          </animated.p>

          <animated.h1
            style={riseStyle(trail[1])}
            className="font-display text-5xl leading-[1.05] tracking-tight text-[var(--ink)] sm:text-7xl"
          >
            Aaron <em className="text-[var(--accent)]">Parisi</em>
          </animated.h1>

          <animated.p
            style={riseStyle(trail[2])}
            className="mx-auto mt-6 max-w-md text-lg leading-relaxed text-[var(--ink-soft)] lg:mx-0"
          >
            Calculus teacher turned self-taught developer. I build interfaces with React,
            TypeScript, and a habit of digging one layer deeper than I need to.
          </animated.p>

          <animated.div style={riseStyle(trail[3])} className="mt-8 flex justify-center lg:justify-start">
            <AnimatedEquation />
          </animated.div>

          <animated.div
            style={riseStyle(trail[4])}
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
        <ChevronDownIcon className="h-5 w-5 animate-bounce" />
      </a>
    </section>
  );
}
