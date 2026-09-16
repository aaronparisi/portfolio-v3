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

// A single 0..1 value drives both letters' dash-offsets, split down the
// middle: the first half of the range draws the A, the second half draws
// the P. Running it back down erases them in the opposite order (P first,
// then A) for free, the same way lifting a pen and re-tracing a signature
// backwards would -- one number, not two separately-tuned timelines that
// could drift out of sync with each other.
const DRAW_CONFIG = { tension: 170, friction: 18 };
const UNDRAW_CONFIG = { tension: 230, friction: 24 };
const BALL_DROP_CONFIG = { tension: 300, friction: 10 };
const BALL_POP_CONFIG = { tension: 420, friction: 20 };
const TILT_CONFIG = { tension: 180, friction: 20 };

/**
 * A purely decorative loading screen -- there's nothing real to wait on,
 * this exists to open the site with a "someone who knows animation built
 * this" moment. An AP monogram draws itself in with real spring physics
 * (visible overshoot as the pen "finishes" each letter), a trio of ink
 * drops bounce in underneath it, then it all erases and repeats a few
 * times before the whole scene pops and fades to reveal the real page.
 * The monogram echoes BrandMark's own "AP" mark in the nav corner -- a
 * visitor who later notices that circle gets the same spark of
 * recognition the equation-box callback used to trade on.
 *
 * Gated out entirely for prefers-reduced-motion by the parent -- this
 * component assumes it's allowed to animate and never renders a static
 * fallback of its own.
 */
export function LoadingScreen({ onComplete }: { onComplete: () => void }) {
  const reduced = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);

  const [ballsShown, setBallsShown] = useState(false);
  const [exiting, setExiting] = useState(false);

  const [draw, drawApi] = useSpring(() => ({ p: 0 }));

  // A faint tilt toward the pointer -- "interactable," not just moving on
  // its own, for anyone who happens to touch the mouse during the couple
  // of seconds this is on screen. Rests at (0,0) and never needs a
  // pointer event to look correct, so it's a bonus, not a dependency.
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
        void drawApi.start({ p: 1, config: DRAW_CONFIG });
        await sleep(750);

        if (!isLive()) return;
        setBallsShown(true);
        await sleep(450);

        if (!isLive()) return;
        await sleep(250);

        // The last loop doesn't erase itself -- it hands off to the exit
        // sequence below with the monogram still fully drawn and the
        // drops still sitting there, not mid-erase into another cycle.
        if (loop === LOOPS - 1) {
          await sleep(300);
          break;
        }

        if (!isLive()) return;
        setBallsShown(false);
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
    // onComplete is a fresh closure from the parent every render, but this
    // effect is only ever meant to run the sequence once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // Four independent strokes, each its own <path> with its own
  // pathLength/dashoffset rather than sharing one dashoffset across
  // subpaths joined by a moveto -- a single dasharray/dashoffset pair
  // spanning multiple subpaths draws them in written order (confirmed:
  // the A's outline draws before its crossbar), but there's no equally
  // reliable guarantee for which end erases first when reversing that
  // same offset back down. Slicing the shared progress value into four
  // fixed ranges and giving each stroke its own path removes the
  // ambiguity entirely -- each one is a plain, single continuous curve,
  // so "offset 1 = hidden, 0 = fully drawn" can't be read any other way.
  const sliceOffset = (start: number, end: number) =>
    draw.p.to((p) => 1 - clamp01((p - start) / (end - start)));
  const aOutlineOffset = sliceOffset(0, 0.35);
  const aCrossbarOffset = sliceOffset(0.35, 0.5);
  const pStemOffset = sliceOffset(0.5, 0.75);
  const pBowlOffset = sliceOffset(0.75, 1);

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
        className="relative"
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
            viewBox="0 0 220 190"
            className="h-56 w-64 sm:h-64 sm:w-72"
            fill="none"
          >
            <animated.path
              d="M18 152 L58 18 L98 152"
              stroke="var(--accent-warm)"
              strokeWidth={8}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              style={{
                strokeDasharray: 1,
                strokeDashoffset: aOutlineOffset,
                filter: "drop-shadow(0 0 10px color-mix(in oklab, var(--accent-warm) 55%, transparent))",
              }}
            />
            <animated.path
              d="M34 100 L82 100"
              stroke="var(--accent-warm)"
              strokeWidth={8}
              strokeLinecap="round"
              pathLength={1}
              style={{
                strokeDasharray: 1,
                strokeDashoffset: aCrossbarOffset,
                filter: "drop-shadow(0 0 10px color-mix(in oklab, var(--accent-warm) 55%, transparent))",
              }}
            />
            <animated.path
              d="M128 18 L128 152"
              stroke="var(--accent)"
              strokeWidth={8}
              strokeLinecap="round"
              pathLength={1}
              style={{
                strokeDasharray: 1,
                strokeDashoffset: pStemOffset,
                filter: "drop-shadow(0 0 10px color-mix(in oklab, var(--accent) 55%, transparent))",
              }}
            />
            <animated.path
              d="M128 18 C 172 18 172 78 128 78"
              stroke="var(--accent)"
              strokeWidth={8}
              strokeLinecap="round"
              pathLength={1}
              style={{
                strokeDasharray: 1,
                strokeDashoffset: pBowlOffset,
                filter: "drop-shadow(0 0 10px color-mix(in oklab, var(--accent) 55%, transparent))",
              }}
            />

            <Ball cx={50} shown={ballsShown} index={0} />
            <Ball cx={110} shown={ballsShown} index={1} />
            <Ball cx={170} shown={ballsShown} index={2} />
          </svg>
        </animated.div>
      </animated.div>

      <span className="sr-only">Loading the page.</span>
    </div>
  );
}

// Ink drops off the pen once each letter finishes -- an underdamped
// spring (low friction relative to tension) naturally overshoots and
// settles with a couple of real bounces, which is the actual physics of
// a dropped ball, not a bounce keyframe faked with an easing curve.
function Ball({ cx, shown, index }: { cx: number; shown: boolean; index: number }) {
  const style = useSpring({
    y: shown ? 0 : -36,
    scale: shown ? 1 : 0,
    opacity: shown ? 1 : 0,
    delay: shown ? index * 90 : (2 - index) * 60,
    config: shown ? BALL_DROP_CONFIG : BALL_POP_CONFIG,
  });
  return (
    <animated.circle
      cx={cx}
      cy={168}
      r={7}
      fill="var(--accent)"
      style={{
        opacity: style.opacity,
        transform: to([style.y, style.scale], (y, s) => `translate(0px, ${y}px) scale(${s})`),
        transformOrigin: `${cx}px 168px`,
        filter: "drop-shadow(0 0 6px color-mix(in oklab, var(--accent) 60%, transparent))",
      }}
    />
  );
}
