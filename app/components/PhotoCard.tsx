import { useEffect, useRef, useState, type PointerEvent } from "react";
import { animated, to, useSprings, useSpring } from "@react-spring/web";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

// Bottom of the stack to top — the order the sheets would actually be laid
// down on a projector: darkest plane first, ink line work drawn last, on
// top, like a grease-pencil outline finishing the drawing. Every PNG here
// is a real derived asset, not a CSS mask: macOS's Vision framework lifted
// the subject from the source photo (see public/images/aaron-photo-cutout.png),
// then each plane was posterized from that cutout's own luminance and edge
// data — see the generation notes in public/images/hero-planes/README.md.
const PLANES = ["shadow", "midtone", "highlight", "line"] as const;

/**
 * The hero portrait, restaged for the Overhead Projector world: instead of
 * a single photo in a rounded frame, Aaron's likeness assembles live from
 * four acetate overlay sheets dropping into place under the light-cone,
 * one at a time, the way a teacher builds up a transparency diagram layer
 * by layer. Once assembled it still tilts toward the cursor with real
 * spring physics and floats gently on its own when idle — the same
 * interaction the old card had, carried over rather than dropped.
 */
export function PhotoCard() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The sheets dropping into place: each plane starts higher up and
  // transparent, as if it's about to be laid onto the platen, then settles
  // with a slight overshoot (low friction relative to tension) — a sheet
  // dropped onto glass doesn't glide in, it falls the last inch and
  // settles.
  const trail = useSprings(
    PLANES.length,
    PLANES.map((_, i) => ({
      from: { opacity: 0, y: -28 },
      to: { opacity: 1, y: 0 },
      delay: reduced ? 0 : 260 + i * 260,
      immediate: reduced,
      config: { tension: 300, friction: 16 },
    })),
  );

  const [style, api] = useSpring(() => ({
    rx: 0,
    ry: 0,
    scale: 1,
    config: { tension: 260, friction: 18 },
  }));

  // A continuous, very small drift — the stack feels lit and alive even
  // before you touch it. See PhotoCard's original comment: visits four
  // waypoints in a loose loop rather than bobbing on one axis.
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
      {/* The projector's own light-cone, anchored behind the stack rather
          than the whole hero, so the portrait reads as the thing actually
          sitting under the lamp. */}
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
        {PLANES.map((plane, i) => (
          <animated.img
            key={plane}
            src={`/images/hero-planes/${plane}.png`}
            alt={i === PLANES.length - 1 ? "Aaron Parisi" : ""}
            aria-hidden={i === PLANES.length - 1 ? undefined : true}
            width={1100}
            height={1100}
            className="absolute inset-0 h-full w-full select-none"
            draggable={false}
            style={{
              opacity: trail[i].opacity,
              transform: trail[i].y.to((y) => `translate3d(0, ${y}px, 0)`),
            }}
          />
        ))}
      </animated.div>
    </div>
  );
}
