import type { MouseEventHandler, ReactNode } from "react";
import { animated, useSpring } from "@react-spring/web";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

type SpringButtonProps = {
  className: string;
  children: ReactNode;
  hoverScale?: number;
  pressScale?: number;
} & ({ href: string; onClick?: undefined } | { href?: undefined; onClick: MouseEventHandler<HTMLButtonElement> });

/**
 * A bouncy, spring-driven pressable — the same feel as the nav's AP
 * logo (low-friction relative to tension, so it visibly overshoots
 * rather than gliding to a stop): grows on hover, shrinks on press, and
 * springs back past its hover size on release instead of just resting
 * there. Renders as a link when given `href` (the only mode this
 * originally supported), or a real `<button>` when given `onClick`
 * instead — for something like a loading screen's "Enter" action, which
 * triggers a callback rather than navigating anywhere.
 */
export function SpringButton({ href, onClick, className, children, hoverScale = 1.06, pressScale = 0.94 }: SpringButtonProps) {
  const reduced = usePrefersReducedMotion();
  const [style, api] = useSpring(() => ({ scale: 1, config: { tension: 300, friction: 12 } }));

  const sharedProps = {
    onPointerEnter: () => !reduced && void api.start({ scale: hoverScale }),
    onPointerLeave: () => void api.start({ scale: 1 }),
    onPointerDown: () => !reduced && void api.start({ scale: pressScale }),
    onPointerUp: () => !reduced && void api.start({ scale: hoverScale }),
    style: { transform: style.scale.to((s) => `scale(${s})`) },
    className,
  };

  if (href !== undefined) {
    return (
      <animated.a href={href} {...sharedProps}>
        {children}
      </animated.a>
    );
  }
  return (
    <animated.button type="button" onClick={onClick} {...sharedProps}>
      {children}
    </animated.button>
  );
}
