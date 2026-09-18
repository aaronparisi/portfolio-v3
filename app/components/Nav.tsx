import { animated, useSpring } from "@react-spring/web";
import { MotionToggle } from "./MotionToggle";
import { BrandMark } from "./BrandMark";
import { SpringButton } from "./SpringButton";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const links = [
  { href: "#about", label: "About" },
  { href: "#journey", label: "Journey" },
  { href: "#skills", label: "Skills" },
  { href: "#contact", label: "Contact" },
];

export function Nav() {
  const reduced = usePrefersReducedMotion();

  // The site "turning on" -- but the nav isn't the first thing to move.
  // Hero's own reveal runs first in full: the 3D calculus surface boots
  // up, the equation gets its featured beat, then the heading/bio/CTA
  // text arrives -- only once all of *that* has settled does the nav
  // drop down from off-screen, with the scroll cue arriving last after
  // it. The 4.3s delay is tuned against that sequence in Hero.tsx
  // (EQUATION_DELAY/SURFACE_SETTLE_DELAY/TEXT_DELAY) -- change one,
  // sanity-check the other. A small overshoot past 0 (low friction
  // relative to tension) reads as a physical thing settling into its
  // slot, not a panel sliding to a stop.
  const entrance = useSpring({
    from: { y: -80, opacity: 0 },
    to: { y: 0, opacity: 1 },
    delay: reduced ? 0 : 4300,
    immediate: reduced,
    config: { tension: 210, friction: 18 },
  });

  return (
    <animated.header
      className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-md"
      style={{ opacity: entrance.opacity, transform: entrance.y.to((y) => `translate3d(0, ${y}px, 0)`) }}
    >
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <BrandMark />

        <div className="hidden items-center gap-1 font-mono text-sm text-[var(--ink-soft)] sm:flex">
          {links.map((l) => (
            <NavLink key={l.href} href={l.href} label={l.label} />
          ))}
        </div>

        <div className="flex items-center gap-3">
          <SpringButton
            href="#contact"
            className="hidden rounded-full border border-[var(--border-strong)] px-4 py-2 font-mono text-sm text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] sm:block"
          >
            Get in touch
          </SpringButton>
          <MotionToggle />
        </div>
      </nav>
    </animated.header>
  );
}

/**
 * Each link owns its own highlight rather than sharing one that travels
 * between them — hovering "Contact" then "About" pops one in and the
 * other out in place, instead of a single shape sliding across the gap
 * between two links that were never actually adjacent in your cursor's
 * path.
 */
function NavLink({ href, label }: { href: string; label: string }) {
  const reduced = usePrefersReducedMotion();
  const [style, api] = useSpring(() => ({
    opacity: 0,
    scale: 0.85,
    config: { tension: 340, friction: 22 },
  }));

  return (
    <a
      href={href}
      onMouseEnter={() => !reduced && void api.start({ opacity: 1, scale: 1 })}
      onMouseLeave={() => void api.start({ opacity: 0, scale: 0.85 })}
      className="relative rounded-full px-4 py-2 transition-colors hover:text-[var(--ink)]"
    >
      <animated.span
        aria-hidden="true"
        className="absolute inset-0 -z-10 rounded-full bg-[var(--bg-alt)]"
        style={style}
      />
      {label}
    </a>
  );
}
