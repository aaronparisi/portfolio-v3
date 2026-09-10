import { animated, useSpring } from "@react-spring/web";
import { useScrollFraction } from "~/hooks/useScrollFraction";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

/** A thin bar across the very top of the viewport tracking read progress. */
export function ScrollProgress() {
  const fraction = useScrollFraction();
  const reduced = usePrefersReducedMotion();

  const style = useSpring({
    scale: fraction,
    immediate: reduced,
    config: { tension: 210, friction: 32 },
  });

  return (
    <animated.div
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-50 h-[3px] origin-left bg-[var(--accent)]"
      style={{ transform: style.scale.to((s) => `scaleX(${s})`) }}
    />
  );
}
