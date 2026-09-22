import { useEffect } from "react";
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

// How long after Hero's text (its own TEXT_DELAY, measured from
// `booted`) to wait before Nav drops in -- long enough for that trail's
// spring (tension 190/friction 22) to have visibly settled, not just
// started. This used to be a delay from Nav's own mount instead, tuned
// by hand against Hero's constants and left to silently drift out of
// sync with them (confirmed: it did, once Hero's `booted` timing
// changed source out from under it) -- keying off the same `booted`
// value Hero itself uses removes that whole class of bug instead of
// just re-tuning the magic number again.
const NAV_DELAY_AFTER_BOOT = 2600;

export function Nav({ booted }: { booted: boolean }) {
  const reduced = usePrefersReducedMotion();

  // A small overshoot past 0 (low friction relative to tension) reads
  // as a physical thing settling into its slot, not a panel sliding to
  // a stop.
  const [entrance, entranceApi] = useSpring(() => ({ y: -80, opacity: 0 }));

  useEffect(() => {
    if (reduced) {
      entranceApi.set({ y: 0, opacity: 1 });
      return;
    }
    if (!booted) return;
    void entranceApi.start({ y: 0, opacity: 1, delay: NAV_DELAY_AFTER_BOOT, config: { tension: 210, friction: 18 } });
  }, [booted, reduced, entranceApi]);

  return (
    // backdrop-blur dropped: this predates the 3D backdrop, but now
    // that a live WebGL canvas sits behind everything (Experience3D.tsx),
    // blurring it through backdrop-filter renders as a distorted ghost/
    // double-image instead of clean frosted glass (confirmed directly,
    // see Hero.tsx's own comment) -- a slightly higher solid opacity
    // reads just as clean without it.
    <animated.header
      className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/92"
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
