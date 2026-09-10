import { useEffect, useState } from "react";
import { animated, useTransition } from "@react-spring/web";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const MATH = "∫ f(x) dx";
const CODE_LABEL = "const solve = (x) =>";
const CODE_BODY = " { ... }";

/**
 * A compact callback to the old "math becomes code" story — crossfades
 * between the two on a loop rather than the old typing/CRT routine, a
 * small recurring detail instead of a whole set piece. Freezes on the
 * code side under reduced motion.
 */
export function EquationMorph() {
  const reduced = usePrefersReducedMotion();
  const [showCode, setShowCode] = useState(reduced);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setShowCode((s) => !s), 3200);
    return () => clearInterval(id);
  }, [reduced]);

  const transitions = useTransition(showCode, {
    from: { opacity: 0, y: 10, scale: 0.94 },
    enter: { opacity: 1, y: 0, scale: 1 },
    leave: { opacity: 0, y: -10, scale: 0.94 },
    immediate: reduced,
    config: { tension: 210, friction: 22 },
  });

  return (
    <div className="relative inline-grid font-mono text-base sm:text-lg">
      {/* Reserves width at the longest string so the flip never reflows
          the surrounding layout. */}
      <span className="invisible whitespace-pre [grid-area:1/1]">
        {CODE_LABEL}
        {CODE_BODY}
      </span>
      {transitions((style, item) => (
        <animated.span style={style} className="whitespace-pre [grid-area:1/1]">
          {item ? (
            <>
              <span className="text-[var(--ink-soft)]">{CODE_LABEL}</span>
              <span className="text-[var(--accent)]">{CODE_BODY}</span>
            </>
          ) : (
            <span className="text-[var(--accent-warm)]">{MATH}</span>
          )}
        </animated.span>
      ))}
    </div>
  );
}
