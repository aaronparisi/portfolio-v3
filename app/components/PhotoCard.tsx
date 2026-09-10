import { useEffect, useRef, useState, type PointerEvent } from "react";
import { animated, to, useSpring } from "@react-spring/web";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

/**
 * The hero portrait: a photo card that tilts toward the cursor with real
 * spring physics (an overshoot-and-settle, not a linear follow), floats
 * gently on its own when idle, and shifts the photo slightly opposite
 * the tilt for a bit of parallax depth inside the frame. A soft two-tone
 * shape sits offset behind it for depth.
 */
export function PhotoCard() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

  // Combining several separate SpringValues into one transform string
  // (via the to([a, b, ...], fn) form) renders a subtly different
  // string on the server than the one the client re-derives on mount —
  // a real hydration mismatch, not just a lint nit; React throws away
  // the whole subtree's hydration rather than reconciling it. Both
  // transforms below are hover/idle-driven and start from a resting
  // state that looks identical with no inline style at all, so neither
  // is rendered until after mount, which sidesteps the mismatch instead
  // of chasing it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [style, api] = useSpring(() => ({
    rx: 0,
    ry: 0,
    scale: 1,
    imgX: 0,
    imgY: 0,
    config: { tension: 260, friction: 18 },
  }));

  // A continuous, very small bob — the card feels alive even before you
  // touch it. Runs independently of the tilt spring above so hovering
  // doesn't have to fight it or reset it.
  const [float, floatApi] = useSpring(() => ({ y: 0 }));
  useEffect(() => {
    if (reduced) return;
    void floatApi.start({
      from: { y: -5 },
      to: async (next) => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await next({ y: 5 });
          await next({ y: -5 });
        }
      },
      config: { duration: 2800 },
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
    void api.start({ ry: px * 16, rx: -py * 16, imgX: -px * 18, imgY: -py * 18 });
  }

  function handleLeave() {
    void api.start({ rx: 0, ry: 0, scale: 1, imgX: 0, imgY: 0 });
  }

  return (
    <div className="relative mx-auto w-full max-w-[22rem]" style={{ perspective: "1400px" }}>
      <div
        aria-hidden="true"
        className="photo-blob absolute -inset-5 -z-10 rotate-3 rounded-[2.5rem] opacity-80"
      />
      <animated.div
        ref={ref}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        onPointerEnter={() => !reduced && void api.start({ scale: 1.015 })}
        className="aspect-[4/5] overflow-hidden rounded-[2rem] border border-[var(--border)] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.35)]"
        style={
          mounted
            ? {
                transform: to(
                  [style.rx, style.ry, style.scale, float.y],
                  (rx, ry, s, fy) =>
                    `translate3d(0, ${fy}px, 0) rotateX(${rx}deg) rotateY(${ry}deg) scale(${s})`,
                ),
                transformStyle: "preserve-3d",
              }
            : { transformStyle: "preserve-3d" }
        }
      >
        <animated.img
          src="/images/aaron-photo.jpg"
          srcSet="/images/aaron-photo-sm.jpg 800w, /images/aaron-photo.jpg 1400w"
          sizes="(max-width: 640px) 90vw, 22rem"
          alt="Aaron Parisi"
          width={1050}
          height={1400}
          className="h-full w-full object-cover"
          style={{
            objectPosition: "50% 48%",
            // The 1.1 scale is baked into this same string (rather than a
            // separate Tailwind scale-110 class) since an inline `style`
            // transform completely replaces any class-based transform
            // rather than combining with it — it needs a little headroom
            // so the parallax translate below never reveals the frame's
            // edge. Applied unconditionally (not gated on `mounted` like
            // the card's own transform above) since 1.1 is a fixed
            // baseline scale, not something that only exists once a
            // spring starts moving — omitting it pre-mount would show a
            // visibly smaller, unzoomed photo for a moment.
            transform: mounted
              ? to([style.imgX, style.imgY], (x, y) => `scale(1.1) translate3d(${x}px, ${y}px, 0)`)
              : "scale(1.1)",
          }}
        />
      </animated.div>
    </div>
  );
}
