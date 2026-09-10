import { useEffect, useState } from "react";
import { animated, to, useSpring } from "@react-spring/web";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

/** The nav's "logo": an AP monogram in a circle, with a spring pop + tilt on hover. */
export function BrandMark() {
  const reduced = usePrefersReducedMotion();
  const [style, api] = useSpring(() => ({
    scale: 1,
    rotate: 0,
    glow: 0,
    config: { tension: 300, friction: 12 },
  }));

  // Combining two separate SpringValues into one transform string (via
  // the to([a, b], fn) form) renders a subtly different string on the
  // server than the one the client re-derives on mount — a real
  // hydration mismatch, not just a lint nit; React throws away the
  // whole subtree's hydration rather than reconciling it. Since this
  // spring only ever moves on hover/press, its resting values (scale 1,
  // rotate 0) look identical whether the inline style is present or
  // absent — so the transform simply isn't rendered until after mount,
  // which sidesteps the mismatch instead of chasing it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <animated.a
      href="#top"
      aria-label="Aaron Parisi — back to top"
      onPointerEnter={() => !reduced && void api.start({ scale: 1.12, rotate: 10, glow: 1 })}
      onPointerLeave={() => void api.start({ scale: 1, rotate: 0, glow: 0 })}
      onPointerDown={() => !reduced && void api.start({ scale: 0.95, rotate: -6 })}
      onPointerUp={() => !reduced && void api.start({ scale: 1.12, rotate: 10 })}
      style={
        mounted
          ? { transform: to([style.scale, style.rotate], (s, r) => `scale(${s}) rotate(${r}deg)`) }
          : undefined
      }
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[var(--accent)] font-display text-sm font-semibold text-[var(--accent)]"
    >
      {/* Same reasoning applies here — var(--accent) baked into a
          JS-built box-shadow string can't be resolved during SSR (no
          live DOM), only on the client, so the color lives in a plain
          CSS class instead and only its opacity is spring-driven (a
          bare number, nothing to mismatch). */}
      <animated.span
        aria-hidden="true"
        className="brand-glow absolute inset-0 rounded-full"
        style={{ opacity: style.glow }}
      />
      <span className="relative">AP</span>
    </animated.a>
  );
}
