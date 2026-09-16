import { useEffect, useRef, useState, type PointerEvent } from "react";
import { animated, to, useSpring } from "@react-spring/web";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const LOOPS = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

// The full Gruvbox bright palette, hardcoded rather than pulled from
// CSS custom properties -- this loader is meant to visibly show off
// several of the theme's colors at once (a graph and a row of bars,
// not a single accent-colored thing), so it reads more as "here's this
// theme's whole palette in motion" than any one semantic token would.
const BAR_COLORS = ["#fb4934", "#fe8019", "#fabd2f", "#b8bb26", "#8ec07c", "#83a598"];
const WAVE_COLORS = ["#d3869b", "#fb4934", "#83a598"];

const DRAW_CONFIG = { tension: 170, friction: 16 };
const UNDRAW_CONFIG = { tension: 230, friction: 22 };
const BAR_CONFIG = { tension: 280, friction: 14 };
const TILT_CONFIG = { tension: 180, friction: 20 };

// A damped sine wave, sampled into a polyline -- an oscillation actually
// decaying to rest, the literal shape of what every spring on this site
// is doing under the hood, not just a decorative squiggle. Computed once
// at module scope since the viewBox is fixed.
function dampedWavePath(width: number, height: number, points = 70) {
  const cy = height / 2;
  const segments: string[] = [];
  for (let i = 0; i <= points; i++) {
    const t = i / points;
    const amp = (1 - t) ** 1.7 * (height * 0.44);
    const y = cy + Math.sin(t * Math.PI * 5.5) * amp;
    segments.push(`${i === 0 ? "M" : "L"} ${(t * width).toFixed(1)} ${y.toFixed(1)}`);
  }
  return segments.join(" ");
}
const WAVE_W = 280;
const WAVE_H = 90;
const WAVE_PATH = dampedWavePath(WAVE_W, WAVE_H);

// Each bar cycles through the same sequence of relative heights, just
// entering it at a different offset -- staggered enough to read as a
// live equalizer instead of everything pulsing in lockstep, without
// needing actual randomness (deterministic, easy to verify).
const HEIGHT_SEQUENCE = [0.3, 0.92, 0.48, 1, 0.36, 0.72, 0.22, 0.6];

/**
 * A purely decorative loading screen -- there's nothing real to wait on,
 * this exists to open the site with a "someone who knows animation
 * built this" moment. A damped-sine-wave graph (the literal shape of a
 * spring settling) draws itself in with real spring physics, hangs for
 * a beat, then erases and redraws a couple more times in a different
 * Gruvbox color each pass, while a row of equalizer bars -- each its
 * own color from the same palette -- bounces underneath the entire
 * time on independent, continuously-looping springs. A faint
 * pointer-tilt makes it "interactable," not just self-playing.
 *
 * Gated out entirely for prefers-reduced-motion by the parent -- this
 * component assumes it's allowed to animate and never renders a static
 * fallback of its own.
 */
export function LoadingScreen({ onComplete }: { onComplete: () => void }) {
  const reduced = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);

  const [exiting, setExiting] = useState(false);
  const [waveColor, setWaveColor] = useState(WAVE_COLORS[0]);
  const [draw, drawApi] = useSpring(() => ({ p: 0 }));

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

  useEffect(() => {
    if (reduced) {
      onComplete();
      return;
    }

    let cancelled = false;
    const isLive = () => !cancelled;

    async function run() {
      for (let loop = 0; loop < LOOPS; loop++) {
        if (!isLive()) return;
        setWaveColor(WAVE_COLORS[loop % WAVE_COLORS.length]);
        void drawApi.start({ p: 1, config: DRAW_CONFIG });
        await sleep(700);

        if (!isLive()) return;
        await sleep(500);

        // The last pass doesn't erase itself -- it hands off to the
        // exit sequence below with the graph still fully drawn.
        if (loop === LOOPS - 1) {
          await sleep(300);
          break;
        }

        if (!isLive()) return;
        void drawApi.start({ p: 0, config: UNDRAW_CONFIG });
        await sleep(550);

        if (!isLive()) return;
        await sleep(150);
      }

      if (!isLive()) return;
      await sleep(200);
      setExiting(true);
      await sleep(550);
      if (!isLive()) return;
      onComplete();
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const waveOffset = draw.p.to((p) => 1 - clamp01(p));

  const stage = useSpring({
    from: { opacity: 0, scale: 0.85 },
    to: exiting ? { opacity: 0, scale: 1.18 } : { opacity: 1, scale: 1 },
    config: exiting ? { tension: 210, friction: 26 } : { tension: 300, friction: 16 },
  });

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

      <animated.div
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className="relative flex flex-col items-center gap-6"
        style={{ opacity: stage.opacity, transform: stage.scale.to((s) => `scale(${s})`), perspective: "900px" }}
      >
        <animated.div
          style={{
            transform: to([tilt.rx, tilt.ry], (rx, ry) => `rotateX(${rx}deg) rotateY(${ry}deg)`),
            transformStyle: "preserve-3d",
          }}
        >
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${WAVE_W} ${WAVE_H}`}
            className="h-20 w-64 sm:h-24 sm:w-72"
            fill="none"
          >
            {/* A dim resting axis -- the wave draws relative to
                something, not floating in a void, reinforcing "this is
                a graph" over "this is a squiggle." */}
            <line x1={0} y1={WAVE_H / 2} x2={WAVE_W} y2={WAVE_H / 2} stroke="var(--ink-soft)" strokeOpacity={0.25} strokeWidth={1} />
            <animated.path
              d={WAVE_PATH}
              stroke={waveColor}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              pathLength={1}
              style={{
                strokeDasharray: 1,
                strokeDashoffset: waveOffset,
                filter: `drop-shadow(0 0 8px ${waveColor}88)`,
              }}
            />
          </svg>

          <div className="mt-2 flex h-16 items-end justify-center gap-3 sm:h-20">
            {BAR_COLORS.map((color, i) => (
              <Bar key={color} color={color} index={i} reduced={reduced} />
            ))}
          </div>
        </animated.div>
      </animated.div>

      <span className="sr-only">Loading the page.</span>
    </div>
  );
}

// A single equalizer bar, bouncing through HEIGHT_SEQUENCE on its own
// clock -- react-spring's async `to` chain (not a fixed setTimeout
// loop) so each leg's overshoot is real spring settling, and stopping
// it on unmount is a single `api.stop()` rather than tracking timers.
function Bar({ color, index, reduced }: { color: string; index: number; reduced: boolean }) {
  const [style, api] = useSpring(() => ({ h: 0.25 }));

  useEffect(() => {
    if (reduced) return;
    void api.start({
      to: async (next) => {
        let i = index; // each bar enters the shared sequence at a different offset
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await next({ h: HEIGHT_SEQUENCE[i % HEIGHT_SEQUENCE.length], config: BAR_CONFIG });
          i++;
        }
      },
    });
    return () => {
      api.stop();
    };
  }, [api, index, reduced]);

  return (
    <div className="flex h-full w-3 items-end sm:w-4">
      <animated.div
        className="w-full rounded-t-full"
        style={{
          height: style.h.to((h) => `${h * 100}%`),
          background: color,
          boxShadow: `0 0 10px ${color}77`,
        }}
      />
    </div>
  );
}
