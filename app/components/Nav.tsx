import { animated, useSpring } from "@react-spring/web";
import { ThemeToggle } from "./ThemeToggle";
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
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-md">
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
          <ThemeToggle />
        </div>
      </nav>
    </header>
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
