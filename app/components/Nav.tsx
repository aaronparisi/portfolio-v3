import { useRef, useState } from "react";
import { animated, useSpring } from "@react-spring/web";
import { ThemeToggle } from "./ThemeToggle";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const links = [
  { href: "#about", label: "About" },
  { href: "#journey", label: "Journey" },
  { href: "#skills", label: "Skills" },
  { href: "#contact", label: "Contact" },
];

export function Nav() {
  const reduced = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0, opacity: 0 });

  const style = useSpring({
    left: indicator.left,
    width: indicator.width,
    opacity: indicator.opacity,
    immediate: reduced,
    config: { tension: 320, friction: 28 },
  });

  function focusOn(el: HTMLElement) {
    const parentRect = containerRef.current?.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (!parentRect) return;
    setIndicator({ left: rect.left - parentRect.left, width: rect.width, opacity: 1 });
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-md">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <a href="#top" className="font-display text-lg italic text-[var(--ink)]">
          Aaron Parisi
        </a>

        <div
          ref={containerRef}
          onMouseLeave={() => setIndicator((i) => ({ ...i, opacity: 0 }))}
          className="relative hidden items-center gap-1 font-mono text-sm text-[var(--ink-soft)] sm:flex"
        >
          {/* The "magnetic pill" — springs to whatever link is currently
              hovered rather than jumping between them. */}
          <animated.span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 h-8 -translate-y-1/2 rounded-full bg-[var(--bg-alt)]"
            style={{ left: style.left, width: style.width, opacity: style.opacity }}
          />
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onMouseEnter={(e) => focusOn(e.currentTarget)}
              className="relative rounded-full px-4 py-2 transition-colors hover:text-[var(--ink)]"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <a
            href="#contact"
            className="hidden rounded-full border border-[var(--border-strong)] px-4 py-2 font-mono text-sm text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] sm:block"
          >
            Get in touch
          </a>
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
