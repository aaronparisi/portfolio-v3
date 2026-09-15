import { useEffect, useRef, useState, type PointerEvent } from "react";
import { animated, to, useSpring } from "@react-spring/web";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

/**
 * The hero portrait as a lens/porthole — the real photo (background and
 * all), circle-cropped like looking through the projector's own lens
 * element, rather than an alpha-matte cutout. Two earlier versions tried
 * cutting Aaron out of the photo entirely: a 4-layer acetate-plane
 * illustration (uncanny up close, especially the edge-detected hair) and a
 * transparent-PNG cutout composited straight onto the page (a soft alpha
 * matte on curly hair reads as a ragged edge, not a clean silhouette). A
 * circular *frame* sidesteps both — the photo's own background stays
 * intact and simply gets cropped by the lens, the way a real optical
 * instrument works, so there's no matte to get wrong.
 *
 * object-position 50% 100% was chosen empirically (see the position
 * contact-sheet in this session's history, not checked in) — it's the
 * value that puts Aaron's eye-line at roughly the top third of the circle,
 * which is where a portrait's focal point belongs.
 */
export function PhotoCard() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The lens settling into place — starts slightly high and transparent,
  // falls the last inch with a touch of overshoot rather than gliding to
  // a stop, the same "dropped onto the platen" language as before.
  const entrance = useSpring({
    from: { opacity: 0, y: -28 },
    to: { opacity: 1, y: 0 },
    delay: reduced ? 0 : 200,
    immediate: reduced,
    config: { tension: 300, friction: 16 },
  });

  // Two coupled springs, not one: the lens housing (ring + glow) tilts and
  // moves toward the cursor like it's magnetically drawn to it, while the
  // photo *inside* the lens pulls the opposite way at a different rate —
  // real parallax between "the glass" and "what's behind it" instead of
  // the whole thing moving as one flat sticker. That's what reads as
  // depth/3D here rather than an actual fisheye pixel-warp, which on a
  // real face tips very easily from "neat" into "uncanny."
  const [lens, lensApi] = useSpring(() => ({
    rx: 0,
    ry: 0,
    mx: 0,
    my: 0,
    scale: 1,
    glow: 0,
    config: { tension: 210, friction: 20 },
  }));

  // A continuous, very small drift — the lens feels lit and alive even
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
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    void lensApi.start({
      ry: px * 12,
      rx: -py * 12,
      mx: px * 14,
      my: py * 14,
      scale: 1.04,
      glow: 1,
    });
  }

  function handleLeave() {
    void lensApi.start({ rx: 0, ry: 0, mx: 0, my: 0, scale: 1, glow: 0 });
  }

  return (
    <div className="relative mx-auto flex w-full max-w-[26rem] justify-center lg:justify-end" style={{ perspective: "1400px" }}>
      {/* The lamp itself lives in Hero.tsx now, anchored to the section's
          top (flush with the nav) rather than to this box -- a cone
          anchored here instead moves with wherever the grid vertically
          centers the photo, which is exactly what left a visible gap
          between the nav and the glow. */}

      <animated.div
        className="relative aspect-square w-[17rem] sm:w-[20rem]"
        style={{
          opacity: entrance.opacity,
          transform: to(
            [entrance.y, float.x, float.y],
            (y, fx, fy) => `translate3d(${fx}px, ${fy + y}px, 0)`,
          ),
        }}
      >
        <animated.div
          ref={wrapRef}
          onPointerMove={handleMove}
          onPointerLeave={handleLeave}
          className="relative h-full w-full cursor-pointer touch-none rounded-full"
          style={
            mounted
              ? {
                  transform: to(
                    [lens.rx, lens.ry, lens.scale],
                    (rx, ry, s) => `rotateX(${rx}deg) rotateY(${ry}deg) scale(${s})`,
                  ),
                  transformStyle: "preserve-3d",
                  // Plain rgba() in the animated interpolator, not
                  // color-mix() -- recalculating color-mix() every frame
                  // during the spring (60fps) was expensive enough to
                  // produce a visible tile-compositing artifact (a faint
                  // grid ghosting across the page) mid-transition on
                  // Chromium. rgba(33,28,21) below is a precomputed
                  // equivalent of color-mix(in oklab, var(--bg) 92%,
                  // var(--accent) 8%) -- it doesn't depend on `g` at all,
                  // but keeping it a literal here (rather than color-mix)
                  // keeps every layer of this string equally cheap.
                  boxShadow: lens.glow.to(
                    (g) =>
                      `0 0 0 1px rgba(232, 188, 120, ${0.45 + g * 0.25}), 0 0 0 10px rgb(33, 28, 21), 0 ${25 + g * 10}px 60px -15px rgba(0,0,0,0.7), 0 0 ${90 + g * 60}px -10px rgba(232, 188, 120, ${0.35 + g * 0.2})`,
                  ),
                }
              : undefined
          }
        >
          {/* isolate: mix-blend-mode on the wash below blends with whatever
              is painted beneath it in the same stacking context — without
              this, that's the whole page (visible as a faint grid ghosting
              across the hero), not just the photo underneath it. */}
          <div className="relative h-full w-full overflow-hidden rounded-full" style={{ isolation: "isolate" }}>
            <animated.img
              src="/images/aaron-photo-sm.jpg"
              alt="Aaron Parisi"
              width={600}
              height={800}
              className="absolute inset-0 h-full w-full select-none object-cover"
              style={{
                objectPosition: "50% 100%",
                transform: to([lens.mx, lens.my], (mx, my) => `translate3d(${-mx}px, ${-my}px, 0) scale(1.12)`),
              }}
              draggable={false}
            />
            {/* Warm wash matching the light-cone's own amber, strongest at
                the crown, so the lamp above reads as actually landing on
                Aaron rather than just glowing behind a photo. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "linear-gradient(180deg, color-mix(in oklab, var(--accent) 32%, transparent), transparent 45%, color-mix(in oklab, var(--accent-warm) 22%, transparent) 100%)",
              }}
            />
          </div>
        </animated.div>
      </animated.div>
    </div>
  );
}
