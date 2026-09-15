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
                  // Chromium. rgb(232,188,120) is --accent and
                  // rgb(57,52,41) is a precomputed color-mix(in oklab,
                  // var(--bg) 92%, var(--accent) 8%) -- both literal since
                  // this is the one spot that can't read the CSS variable
                  // at animation time without paying for color-mix() again.
                  // Gruvbox-theme experiment: recomputed both from this
                  // branch's --accent (#fabd2f) / --bg (#282828) --
                  // literal colors don't follow the variable swap for free.
                  boxShadow: lens.glow.to(
                    (g) =>
                      `0 0 0 1px rgba(250, 189, 47, ${0.45 + g * 0.25}), 0 0 0 10px rgb(57, 52, 41), 0 ${25 + g * 10}px 60px -15px rgba(0,0,0,0.7), 0 0 ${90 + g * 60}px -10px rgba(250, 189, 47, ${0.35 + g * 0.2})`,
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
                // Gruvbox-theme experiment: a much stronger sepia than the
                // fancy-design version's light grade (0.4). At 0.4, a dark
                // saturated color like the maroon jacket barely moves --
                // sepia's matrix pulls hardest on colors with room to
                // shift, so the face tinted while the jacket stayed
                // stubbornly itself. Pushed close to full sepia so every
                // region gets remapped into the same warm tonal family
                // regardless of its starting hue, then saturate() back up
                // to keep it a rich duotone-ish gold rather than a washed-
                // out old photograph.
                filter: "sepia(0.85) saturate(1.7) hue-rotate(-8deg) brightness(0.92) contrast(1.15)",
                transform: to([lens.mx, lens.my], (mx, my) => `translate3d(${-mx}px, ${-my}px, 0) scale(1.12)`),
              }}
              draggable={false}
            />
            {/* Warm wash matching the light-cone's own amber, strongest at
                the crown, so the lamp above reads as actually landing on
                Aaron rather than just glowing behind a photo. Gruvbox-theme
                experiment: the fancy-design version's wash dropped to fully
                transparent through the middle (40%-55%) before rising again
                at the very bottom -- fine when the base filter alone
                carried the jacket, but with the near-full sepia above doing
                that job now, this only has to add gentle top-to-bottom
                direction, so it stays present (never truly 0) the whole way
                down instead of leaving a flat gap. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "linear-gradient(180deg, color-mix(in oklab, var(--accent) 38%, transparent), color-mix(in oklab, var(--accent) 14%, transparent) 35%, color-mix(in oklab, var(--accent-warm) 12%, transparent) 65%, color-mix(in oklab, var(--accent-warm) 30%, transparent) 100%)",
              }}
            />
          </div>
        </animated.div>
      </animated.div>
    </div>
  );
}
