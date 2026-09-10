import type { ReactNode } from "react";
import { animated, useSpring } from "@react-spring/web";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

/**
 * A bouncy, spring-driven pressable — the same feel as the nav's AP
 * logo (low-friction relative to tension, so it visibly overshoots
 * rather than gliding to a stop): grows on hover, shrinks on press, and
 * springs back past its hover size on release instead of just resting
 * there.
 */
export function SpringButton({
  href,
  className,
  children,
  hoverScale = 1.06,
  pressScale = 0.94,
}: {
  href: string;
  className: string;
  children: ReactNode;
  hoverScale?: number;
  pressScale?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const [style, api] = useSpring(() => ({ scale: 1, config: { tension: 300, friction: 12 } }));

  return (
    <animated.a
      href={href}
      onPointerEnter={() => !reduced && void api.start({ scale: hoverScale })}
      onPointerLeave={() => void api.start({ scale: 1 })}
      onPointerDown={() => !reduced && void api.start({ scale: pressScale })}
      onPointerUp={() => !reduced && void api.start({ scale: hoverScale })}
      style={{ transform: style.scale.to((s) => `scale(${s})`) }}
      className={className}
    >
      {children}
    </animated.a>
  );
}
