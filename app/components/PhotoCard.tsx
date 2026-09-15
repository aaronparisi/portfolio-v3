import { useEffect, useRef, useState, type PointerEvent } from "react";
import { animated, to, useSpring } from "@react-spring/web";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

/**
 * The hero portrait, sitting under the projector's own light-cone. This is
 * the real photo (public/images/aaron-photo-cutout.png), not a projected
 * illustration — an earlier version rebuilt it as four stacked acetate
 * overlay planes (edge-detected line art + posterized color fields), which
 * read as slightly uncanny up close (see git history / hero-planes/README.md
 * if reviving that idea). A real photo, warmed with a top-down amber wash so
 * the light-cone above it looks like it's actually landing on Aaron rather
 * than just glowing behind a flat cutout, reads as correct in a way the
 * illustrated version didn't. See scripts/generate-hero-tint.mjs for exactly
 * how hero-tinted.png was derived from the cutout — same Playwright-canvas
 * approach as the old plane generator, just one gradient-tint pass instead
 * of four posterized ones.
 *
 * The tilt-toward-cursor and idle float are carried over unchanged from the
 * original card — that interaction was never the problem.
 */
export function PhotoCard() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // A single settle-in, the way a slide drops onto the platen — starts
  // slightly high and transparent, falls the last inch with a touch of
  // overshoot rather than gliding to a stop.
  const entrance = useSpring({
    from: { opacity: 0, y: -28 },
    to: { opacity: 1, y: 0 },
    delay: reduced ? 0 : 200,
    immediate: reduced,
    config: { tension: 300, friction: 16 },
  });

  const [style, api] = useSpring(() => ({
    rx: 0,
    ry: 0,
    scale: 1,
    config: { tension: 260, friction: 18 },
  }));

  // A continuous, very small drift — the portrait feels lit and alive even
  // before you touch it, visiting four waypoints in a loose loop rather
  // than bobbing on one axis.
  const [float, floatApi] = useSpring(() => ({ x: 0, y: 0 }));
  useEffect(() => {
    if (reduced) return;
    void floatApi.start({
      from: { x: 0, y: -6 },
      to: async (next) => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await next({ x: 6, y: 0 });
          await next({ x: 0, y: 6 });
          await next({ x: -6, y: 0 });
          await next({ x: 0, y: -6 });
        }
      },
      config: { duration: 2600 },
    });
    return () => {
      floatApi.stop();
    };
  }, [reduced, floatApi]);

  function handleMove(e: PointerEvent<HTMLDivElement>) {
    if (reduced) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    void api.start({ ry: px * 12, rx: -py * 12 });
  }

  function handleLeave() {
    void api.start({ rx: 0, ry: 0, scale: 1 });
  }

  return (
    <div className="relative mx-auto w-full max-w-[24rem]" style={{ perspective: "1400px" }}>
      {/* The projector's own light-cone, anchored behind the portrait rather
          than the whole hero, so it reads as the thing actually sitting
          under the lamp. */}
      <div aria-hidden="true" className="light-cone lamp-flicker absolute -inset-16 -z-10" />

      <animated.div
        ref={ref}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        onPointerEnter={() => !reduced && void api.start({ scale: 1.015 })}
        className="relative aspect-square"
        style={
          mounted
            ? {
                transform: to(
                  [style.rx, style.ry, style.scale, float.x, float.y],
                  (rx, ry, s, fx, fy) =>
                    `translate3d(${fx}px, ${fy}px, 0) rotateX(${rx}deg) rotateY(${ry}deg) scale(${s})`,
                ),
                transformStyle: "preserve-3d",
              }
            : { transformStyle: "preserve-3d" }
        }
      >
        <animated.img
          src="/images/hero-tinted.png"
          alt="Aaron Parisi"
          width={1100}
          height={1100}
          className="absolute inset-0 h-full w-full select-none"
          draggable={false}
          style={{
            opacity: entrance.opacity,
            transform: entrance.y.to((y) => `translate3d(0, ${y}px, 0)`),
          }}
        />
      </animated.div>
    </div>
  );
}
