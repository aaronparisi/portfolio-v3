import { useEffect, useRef, useState, type PointerEvent } from "react";
import { animated, to, useSpring } from "@react-spring/web";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

// The CRT wipe's diagonal boundary, shared by the clip-path that reveals
// the layer AND the scan-beam that rides its edge -- both derived from the
// same (p, skew) pair rather than two separately-tuned values, so they
// can never drift out of alignment the way a plain vertical bar did
// against this diagonal edge.
const WIPE_SKEW = 18;
function wipeEdgeX(p: number) {
  return p * (100 + WIPE_SKEW * 2) - WIPE_SKEW;
}

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
 * object-position was chosen empirically against a percentage-grid
 * overlay on the source photo (see this session's history, not checked
 * in) — 50% 88% sits the eye-line just below the top third, close to
 * fancy-design's own 100% but backed off slightly per Gruvbox-theme
 * feedback that it read as too high/centered.
 */
export function PhotoCard() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const isHoveringRef = useRef(false);
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

  // The sepia-to-CRT wipe: a single progress value driving a diagonal
  // clip-path reveal. p=0 is fully sepia, p=1 is fully "hacker" (grayscale
  // + green phosphor tint + scanlines); react-spring for the same
  // physical, slightly-overshooting settle every other motion on this
  // card uses, not a linear CSS transition.
  const [crt, crtApi] = useSpring(() => ({ p: 0, config: { tension: 20, friction: 13 } }));

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
    isHoveringRef.current = false;
    void lensApi.start({ rx: 0, ry: 0, mx: 0, my: 0, scale: 1, glow: 0 });
    void crtApi.start({ p: 0 });
  }

  function handleEnter() {
    isHoveringRef.current = true;
    if (reduced) return;
    void crtApi.start({ p: 1 });
  }

  // A one-time hint, a few seconds after the page settles: the wipe
  // exists as a real interactive effect, not just a decoration, so it's
  // worth surfacing once rather than requiring a visitor to already know
  // to hover a circular photo. A small peek (20%, not a full reveal) and
  // back, not a loop -- it should read as "try hovering me", not as an
  // idle animation running forever.
  useEffect(() => {
    if (reduced) return;
    let closeTimer = 0;
    const openTimer = window.setTimeout(() => {
      if (isHoveringRef.current) return;
      // A snappier config than the wipe's own (tension 20/friction 13,
      // tuned to take ~300ms to cross the whole circle) -- at that speed,
      // a 700ms-ish hold barely gets partway to 20% before reversing, so
      // the hint reads as a faint flicker instead of an actual peek. This
      // override only affects this one call, not the hover wipe itself.
      void crtApi.start({ p: 0.2, config: { tension: 210, friction: 18 } });
      closeTimer = window.setTimeout(() => {
        if (isHoveringRef.current) return;
        void crtApi.start({ p: 0, config: { tension: 90, friction: 16 } });
      }, 900);
    }, 5000);
    return () => {
      window.clearTimeout(openTimer);
      window.clearTimeout(closeTimer);
    };
  }, [reduced, crtApi]);

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
          onPointerEnter={handleEnter}
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
                objectPosition: "50% 88%",
                // Gruvbox-theme experiment: strong sepia (0.85, up from
                // fancy-design's 0.4 -- see that commit) so every region,
                // including the dark saturated jacket, gets remapped into
                // one warm tonal family regardless of starting hue. First
                // attempt then re-saturated hard (1.7) to keep it "rich",
                // which overshot into vivid gold instead of sepia -- an
                // actual sepia photograph is muted and brownish, not
                // saturated. Saturate is now barely above neutral.
                filter: "sepia(0.85) saturate(1.05) hue-rotate(-4deg) brightness(0.95) contrast(1.08)",
                transform: to([lens.mx, lens.my], (mx, my) => `translate3d(${-mx}px, ${-my}px, 0) scale(1.12)`),
              }}
              draggable={false}
            />
            {/* Warm wash matching the light-cone's own amber -- direction,
                not a second light source. The first pass put 38% accent
                right over the crown, which is exactly where the face sits
                (object-position: 50% 100% puts the eye-line in the top
                third, see PhotoCard's own doc comment) -- strong enough to
                wash the features out instead of just suggesting light
                landing there. Cut roughly in half throughout; still
                present the whole way down (no dead zone, per the earlier
                fix) but now a suggestion of light, not a veil over it. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "linear-gradient(180deg, color-mix(in oklab, var(--accent) 16%, transparent), color-mix(in oklab, var(--accent) 6%, transparent) 35%, color-mix(in oklab, var(--accent-warm) 6%, transparent) 65%, color-mix(in oklab, var(--accent-warm) 16%, transparent) 100%)",
              }}
            />

            {/* The sepia-to-CRT wipe: hover sweeps a "hacker" layer
                (grayscale photo + green-phosphor tint + scanlines) across
                the lens on a diagonal clip-path, instead of the whole
                image just cross-fading -- a wipe reads as something being
                revealed, a cross-fade reads as a settings toggle. isolate
                on this whole sub-tree contains its own mix-blend-mode
                (the green tint) to itself, same reason as the wash's own
                isolate above. */}
            <animated.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                isolation: "isolate",
                clipPath: crt.p.to((p) => {
                  const x = wipeEdgeX(p);
                  return `polygon(0% 0%, ${x + WIPE_SKEW}% 0%, ${x - WIPE_SKEW}% 100%, 0% 100%)`;
                }),
              }}
            >
              <animated.img
                src="/images/aaron-photo-sm.jpg"
                aria-hidden="true"
                className="absolute inset-0 h-full w-full select-none object-cover"
                style={{
                  objectPosition: "50% 88%",
                  // Grayscale first, then a solid green laid on top with
                  // mix-blend-mode: color -- that recolors the grayscale
                  // luminance into a true monochrome phosphor green
                  // (hue+saturation from the top layer, lightness from
                  // what's under it), the same trick as a photo duotone,
                  // without needing an SVG filter.
                  filter: "grayscale(1) contrast(1.35) brightness(1.1)",
                  transform: to([lens.mx, lens.my], (mx, my) => `translate3d(${-mx}px, ${-my}px, 0) scale(1.12)`),
                }}
                draggable={false}
              />
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: "#b8bb26", mixBlendMode: "color" }}
              />
              {/* Scanlines -- 2px on, 2px off reads as a CRT at this
                  photo's actual display size; much finer just moirés. */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "repeating-linear-gradient(0deg, rgba(0,0,0,0.35) 0px, rgba(0,0,0,0.35) 1px, transparent 1px, transparent 3px)",
                  mixBlendMode: "multiply",
                }}
              />
              <div
                className="pointer-events-none absolute inset-0"
                style={{ boxShadow: "inset 0 0 2.5rem rgba(0,0,0,0.55)" }}
              />
            </animated.div>

            {/* A bright phosphor scan-beam riding the wipe's own leading
                edge -- present only while the wipe is actually in
                transit (a bell curve of p, zero at both rest states),
                the flash-and-fade a real scan line leaves rather than a
                static seam. Clipped to a thin parallelogram parallel to
                the main wipe's own boundary (same wipeEdgeX/WIPE_SKEW),
                not a plain vertical bar -- a vertical highlight next to a
                diagonal cut line very visibly didn't line up. */}
            <animated.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                clipPath: crt.p.to((p) => {
                  const x = wipeEdgeX(p);
                  const r = 1.6; // band half-width, in the same % units as the edge
                  return `polygon(${x + WIPE_SKEW - r}% 0%, ${x + WIPE_SKEW + r}% 0%, ${x - WIPE_SKEW + r}% 100%, ${x - WIPE_SKEW - r}% 100%)`;
                }),
                opacity: crt.p.to((p) => 4 * p * (1 - p)),
                background: "#b8bb26",
                // filter, not boxShadow: a box-shadow follows the element's
                // full rectangular border-box, not its clip-path, so it
                // would glow as a vertical rectangle regardless of the
                // parallelogram's actual angle. drop-shadow follows the
                // clipped alpha shape.
                filter: "drop-shadow(0 0 8px #b8bb26) drop-shadow(0 0 18px rgba(184, 187, 38, 0.6))",
              }}
            />
          </div>
        </animated.div>
      </animated.div>
    </div>
  );
}
