import type { ReactNode } from "react";
import { animated, useSpring, useTrail } from "@react-spring/web";
import { PhotoCard } from "./PhotoCard";
import { ChevronDownIcon } from "./icons";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const TRAIL_ITEMS = 4; // eyebrow, heading, bio, cta row

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
            style={trail[0]}
            className="eyebrow mb-5 flex items-center justify-center gap-2 lg:justify-start"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
            </span>
            Frontend Developer @ Turngate
          </animated.p>

          <animated.h1
            style={trail[1]}
            className="font-display text-5xl leading-[1.05] tracking-tight text-[var(--ink)] sm:text-7xl"
          >
            Aaron <em className="text-[var(--accent)]">Parisi</em>
          </animated.h1>

          <animated.p
            style={trail[2]}
            className="mx-auto mt-6 max-w-md text-lg leading-relaxed text-[var(--ink-soft)] lg:mx-0"
          >
            Calculus teacher turned self-taught developer. I build interfaces with React,
            TypeScript, and a habit of digging one layer deeper than I need to.
          </animated.p>

          <animated.div
            style={trail[3]}
            className="mt-10 flex flex-wrap items-center justify-center gap-4 lg:justify-start"
          >
            <HeroButton href="#journey" variant="primary">
              See my journey
            </HeroButton>
            <HeroButton href="#contact" variant="secondary">
              Get in touch
            </HeroButton>
          </animated.div>
        </div>

        <animated.div style={photoSpring}>
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

function HeroButton({
  href,
  variant,
  children,
}: {
  href: string;
  variant: "primary" | "secondary";
  children: ReactNode;
}) {
  const reduced = usePrefersReducedMotion();
  const [style, api] = useSpring(() => ({ scale: 1, config: { tension: 380, friction: 14 } }));

  return (
    <animated.a
      href={href}
      onPointerEnter={() => !reduced && void api.start({ scale: 1.05 })}
      onPointerLeave={() => void api.start({ scale: 1 })}
      onPointerDown={() => !reduced && void api.start({ scale: 0.96 })}
      onPointerUp={() => !reduced && void api.start({ scale: 1.05 })}
      style={{ transform: style.scale.to((s) => `scale(${s})`) }}
      className={`rounded-full px-6 py-3 font-medium ${variant === "primary" ? "btn-primary" : "btn-secondary"}`}
    >
      {children}
    </animated.a>
  );
}
