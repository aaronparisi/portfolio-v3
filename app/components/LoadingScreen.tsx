import { useEffect, useRef, useState, type PointerEvent } from "react";
import { animated, config as springConfig, to, useSpring, useTrail } from "@react-spring/web";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

// The Gruvbox bright palette, hardcoded rather than pulled from CSS
// custom properties -- this loader is meant to visibly show off
// several of the theme's colors at once, not lean on a single
// semantic accent token the way the rest of the site does.
const BAR_COLORS = ["#fb4934", "#fe8019", "#fabd2f", "#b8bb26", "#8ec07c", "#83a598", "#d3869b"];
// Uneven peaks -- an equalizer where every bar tops out the same
// height reads as a progress bar wearing a costume, not a live signal.
const PEAK_SCALES = [6, 8.5, 5, 9.5, 6.5, 8, 5.5];
const BAR_COUNT = BAR_COLORS.length;

const LOAD_DURATION = 5200;
const TILT_CONFIG = { tension: 180, friction: 20 };

/**
 * A purely decorative loading screen -- there's nothing real to wait on,
 * this exists to open the site with a "someone who knows animation
 * built this" moment.
 *
 * The core mechanic -- a spring `useTrail` reversing between two states
 * in an endless loop, then redirected to a single settle-to-zero pass
 * once `exiting` flips -- is Aaron's own sketch in LoadingSpring.tsx,
 * dressed up here with per-bar Gruvbox colors, uneven peaks and
 * staggered delays so it reads as a live equalizer rather than several
 * identical bars in unison, plus glow, reflections, and a pointer-tilt
 * so it's "interactable," not just self-playing.
 *
 * Gated out entirely for prefers-reduced-motion by the parent -- this
 * component assumes it's allowed to animate and never renders a static
 * fallback of its own.
 */
export function LoadingScreen({ onComplete }: { onComplete: () => void }) {
  const reduced = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (reduced) {
      onComplete();
      return;
    }
    const timer = window.setTimeout(() => setExiting(true), LOAD_DURATION);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // The trail starts at a plain resting value and is driven entirely
  // imperatively from here on -- both the endless wobble and its later
  // redirect into the exit are explicit barsApi.start() calls in mount-
  // and exiting-triggered effects, never the declarative per-render form.
  // An earlier version passed the wobbly `{ loop: { reverse: true }, ... }`
  // config directly as useTrail's own reactive props; since that factory
  // function returns a brand-new object (and a brand-new `loop` object)
  // on every render, react-spring kept re-asserting the endless loop on
  // renders that happened after `exiting` flipped true, racing against
  // -- and winning over -- the one-shot exit animation. Confirmed by
  // logging: the exit's onRest never fired, and the bars visibly bounced
  // back up to full height instead of staying collapsed. Starting both
  // phases only from effects, never from a live render-time config,
  // removes that race entirely.
  const [bars, barsApi] = useTrail<{ scaleY: number; opacity: number }>(BAR_COUNT, () => ({
    scaleY: 1,
    opacity: 1,
  }));

  useEffect(() => {
    if (reduced) return;
    void barsApi.start((i) => ({
      from: { scaleY: 1, opacity: 1 },
      to: { scaleY: PEAK_SCALES[i], opacity: 1 },
      loop: { reverse: true },
      delay: i * 90,
      config: springConfig.wobbly,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  useEffect(() => {
    if (!exiting) return;
    // .stop() first -- cancels the endless wobble's internal async
    // chain outright rather than trusting a same-tick .start() call to
    // cleanly preempt it.
    barsApi.stop();
    void barsApi.start((i) => ({
      to: { scaleY: 0, opacity: 0 },
      loop: false,
      delay: i * 55,
      config: springConfig.stiff,
    }));
    // onComplete on a fixed timer, not this spring's own onRest --
    // measured via getComputedStyle sampling: the last bar reads as
    // fully invisible (opacity/scale both under 0.02) within about a
    // second, but onRest itself didn't fire until ~3.6s in. A spring
    // interrupted mid-oscillation (this one was still actively
    // reversing when `exiting` flipped) carries real residual velocity
    // into its new target, and react-spring's rest detection waits for
    // that velocity to decay to near float-precision zero, not just for
    // the value to look done -- an appropriate default for a spring
    // meant to be watched, not one gating a callback. 1400ms comfortably
    // clears the point where it's visually finished without waiting out
    // that asymptotic tail.
    const timer = window.setTimeout(onComplete, 1400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exiting]);

  const [tilt, tiltApi] = useSpring(() => ({ rx: 0, ry: 0, config: TILT_CONFIG }));

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (reduced) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    void tiltApi.start({ ry: px * 16, rx: -py * 16 });
  }

  function handlePointerLeave() {
    void tiltApi.start({ rx: 0, ry: 0 });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "var(--bg)" }}
      role="status"
      aria-label="Loading"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--accent) 16%, transparent), transparent 60%)",
        }}
      />

      <div
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        style={{ perspective: "900px" }}
      >
        <animated.div
          className="flex items-end gap-3 sm:gap-4"
          style={{
            transform: to([tilt.rx, tilt.ry], (rx, ry) => `rotateX(${rx}deg) rotateY(${ry}deg)`),
            transformStyle: "preserve-3d",
          }}
        >
          {bars.map((style, i) => (
            <div key={i} className="flex flex-col items-center">
              <div className="flex h-24 w-3 items-end justify-center sm:h-28 sm:w-4">
                <animated.div
                  className="w-full rounded-t-full"
                  style={{
                    height: 10,
                    transformOrigin: "bottom",
                    transform: style.scaleY.to((s) => `scaleY(${s})`),
                    opacity: style.opacity,
                    background: BAR_COLORS[i],
                    boxShadow: `0 0 12px ${BAR_COLORS[i]}99`,
                  }}
                />
              </div>
              {/* A faint reflection beneath each bar -- the same live
                  scaleY value, just anchored to its top edge and
                  flipped in intensity, the kind of detail that reads
                  as "someone who knows animation" without needing its
                  own animation logic. */}
              <animated.div
                aria-hidden="true"
                className="w-3 rounded-b-full sm:w-4"
                style={{
                  height: 10,
                  marginTop: 2,
                  transformOrigin: "top",
                  transform: style.scaleY.to((s) => `scaleY(${s * 0.4})`),
                  opacity: style.opacity.to((o) => o * 0.22),
                  background: BAR_COLORS[i],
                }}
              />
            </div>
          ))}
        </animated.div>
      </div>

      <span className="sr-only">Loading the page.</span>
    </div>
  );
}
