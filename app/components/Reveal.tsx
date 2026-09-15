import { useEffect, useRef, useState, type ReactNode } from "react";
import { animated, useSpring } from "@react-spring/web";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

/**
 * Springs children in (fade + rise) the first time they scroll into
 * view. A real spring rather than a CSS ease-out curve — it settles with
 * a faint, physical give rather than gliding to a stop at a fixed rate.
 */
export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const style = useSpring({
    opacity: visible ? 1 : 0,
    y: visible ? 0 : 28,
    delay: visible ? delay : 0,
    immediate: reduced,
    config: { tension: 190, friction: 24 },
  });

  return (
    <animated.div
      ref={ref}
      className={className}
      style={{ opacity: style.opacity, transform: style.y.to((y) => `translate3d(0, ${y}px, 0)`) }}
    >
      {children}
    </animated.div>
  );
}
