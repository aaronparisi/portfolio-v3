import { useEffect, useState } from "react";
import { animated, useSpring, useSprings } from "@react-spring/web";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const MATH_CHARS = Array.from("∫ f(x) dx");
const CODE_TEXT = "const";
const LOOPS = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Same spring language AnimatedEquation uses for this exact motif (math
// drawing in, a CRT screen booting/shutting down) -- this loading screen
// is a preview of that same ambient animation, not a different one, so
// a visitor who watches this once should feel a spark of recognition
// when they later notice it looping quietly in the hero's equation box.
const DRAW_CONFIG = { tension: 320, friction: 24 };
const BOOT_CONFIG = { tension: 320, friction: 13 };
const SHUTDOWN_CONFIG = { tension: 320, friction: 30 };

/**
 * A purely decorative loading screen -- there's nothing real to wait on,
 * this exists to open the site with a "someone who knows animation built
 * this" moment. Runs the calculus->code motif three times, fast, then
 * springs open to reveal the real page. Gated entirely out of the tree by
 * the parent when prefers-reduced-motion is on -- this component assumes
 * it's allowed to animate and never renders a static fallback of its own.
 */
export function LoadingScreen({ onComplete }: { onComplete: () => void }) {
  const reduced = usePrefersReducedMotion();

  const [mathRevealed, setMathRevealed] = useState(0);
  const [crossedOut, setCrossedOut] = useState(false);
  const [arrowShown, setArrowShown] = useState(false);
  const [boxPower, setBoxPower] = useState<"off" | "on">("off");
  const [bootConfig, setBootConfig] = useState(BOOT_CONFIG);
  const [codeRevealed, setCodeRevealed] = useState(0);
  const [caretBlinking, setCaretBlinking] = useState(false);
  const [loopsDone, setLoopsDone] = useState(0);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // Reduced-motion visitors never see this component at all (the
    // parent route skips rendering it) -- but guard anyway rather than
    // assume, the same discipline every other animated component here
    // uses.
    if (reduced) {
      onComplete();
      return;
    }

    let cancelled = false;
    const isLive = () => !cancelled;

    async function run() {
      for (let loop = 0; loop < LOOPS; loop++) {
        if (!isLive()) return;

        for (let i = 1; i <= MATH_CHARS.length; i++) {
          if (!isLive()) return;
          setMathRevealed(i);
          await sleep(35);
        }

        if (!isLive()) return;
        await sleep(120);
        setCrossedOut(true);
        await sleep(220);

        if (!isLive()) return;
        await sleep(90);
        setArrowShown(true);
        await sleep(160);

        if (!isLive()) return;
        setBootConfig(BOOT_CONFIG);
        setBoxPower("on");
        await sleep(220);

        if (!isLive()) return;
        setCaretBlinking(true);
        for (let i = 1; i <= CODE_TEXT.length; i++) {
          if (!isLive()) return;
          setCodeRevealed(i);
          await sleep(45);
        }

        if (!isLive()) return;
        await sleep(360);

        // The last loop doesn't unwind the normal way -- it hands off
        // to the exit sequence below instead, so the CRT box is still
        // fully "on" (bright, legible) at the moment the screen opens,
        // not mid-fade into its own next cycle.
        if (loop === LOOPS - 1) {
          setLoopsDone(loop + 1);
          break;
        }

        setCaretBlinking(false);
        setBootConfig(SHUTDOWN_CONFIG);
        setBoxPower("off");
        setCodeRevealed(0);
        await sleep(180);

        if (!isLive()) return;
        setArrowShown(false);
        setCrossedOut(false);
        setMathRevealed(0);
        setLoopsDone(loop + 1);
        await sleep(220);
      }

      if (!isLive()) return;
      await sleep(260);
      setExiting(true);
      await sleep(520);
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

  const mathSprings = useSprings(
    MATH_CHARS.length,
    MATH_CHARS.map((_, i) => ({
      opacity: i < mathRevealed ? 1 : 0,
      y: i < mathRevealed ? 0 : -10,
      config: DRAW_CONFIG,
    })),
  );

  const curveDraw = useSpring({
    offset: mathRevealed / MATH_CHARS.length,
    config: DRAW_CONFIG,
  });

  const crossOut = useSpring({
    scaleX: mathRevealed === MATH_CHARS.length && crossedOut ? 1 : 0,
    config: DRAW_CONFIG,
  });

  const arrow = useSpring({
    opacity: arrowShown ? 1 : 0,
    config: { tension: 260, friction: 24 },
  });

  const box = useSpring({
    scaleY: boxPower === "on" ? 1 : 0,
    config: bootConfig,
  });

  // The screen itself: a bright pop-open on arrival (a beat of
  // overshoot, the site's usual "settling into place" language), then a
  // clean scale-and-fade dissolve to reveal the real page once the
  // sequence finishes -- not a mirror of the entrance, a screen turning
  // off doesn't reverse-play its own boot animation.
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
      {/* A centered glow standing in for the light-cone every other
          section of the page sits under -- this screen is the room
          before the lamp has picked out anything in particular yet. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--accent) 16%, transparent), transparent 60%)",
        }}
      />

      <animated.div
        className="relative flex flex-col items-center gap-8"
        style={{ opacity: stage.opacity, transform: stage.scale.to((s) => `scale(${s})`) }}
      >
        {/* A curve drawing itself in behind the equation -- pathLength="1"
            makes the dash math trivial (1 = fully hidden, 0 = fully
            drawn), rather than needing the path's real measured length. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 400 130"
          className="pointer-events-none absolute -top-16 h-32 w-[26rem] max-w-[80vw] opacity-70"
        >
          <animated.path
            d="M 20 110 Q 200 -40 380 110"
            fill="none"
            stroke="var(--accent-warm)"
            strokeWidth="3"
            strokeLinecap="round"
            pathLength={1}
            style={{
              strokeDasharray: 1,
              strokeDashoffset: curveDraw.offset.to((o) => 1 - o),
              filter: "drop-shadow(0 0 6px color-mix(in oklab, var(--accent-warm) 55%, transparent))",
            }}
          />
        </svg>

        <div className="flex flex-wrap items-center justify-center gap-4 font-mono text-3xl sm:text-5xl">
          <span
            className="relative inline-block whitespace-pre rounded-2xl border px-5 py-3"
            style={{ background: "var(--board)", color: "var(--marker)", borderColor: "var(--border)" }}
          >
            {MATH_CHARS.map((char, i) => (
              <animated.span
                key={i}
                className="inline-block"
                style={{
                  opacity: mathSprings[i].opacity,
                  transform: mathSprings[i].y.to((y) => `translate3d(0, ${y}px, 0)`),
                }}
              >
                {char}
              </animated.span>
            ))}
            <animated.span
              aria-hidden="true"
              className="pointer-events-none absolute left-5 right-5 top-1/2 h-[3px]"
              style={{
                background: "var(--marker)",
                transform: crossOut.scaleX.to((s) => `translateY(-50%) scaleX(${s})`),
                transformOrigin: "left center",
              }}
            />
          </span>

          <animated.span style={{ opacity: arrow.opacity }} className="text-[var(--ink-soft)]">
            →
          </animated.span>

          <animated.span
            className="relative inline-grid rounded-2xl border px-5 py-3 text-left"
            style={{
              background: "var(--board)",
              color: "var(--accent)",
              borderColor: "var(--border)",
              transform: box.scaleY.to((s) => `scaleY(${s})`),
            }}
          >
            <span className="invisible whitespace-pre [grid-area:1/1]">
              {CODE_TEXT}
              <span className="ml-1 inline-block h-[1em] w-[0.5em] align-middle" />
            </span>
            <span className="whitespace-pre [grid-area:1/1]">
              {CODE_TEXT.slice(0, codeRevealed)}
              <span
                className={`ml-1 inline-block h-[0.85em] w-[0.5em] align-middle ${caretBlinking ? "typing-caret" : "opacity-0"}`}
                style={{ background: "var(--accent)" }}
              />
            </span>
          </animated.span>
        </div>

        <div className="flex items-center gap-3" aria-hidden="true">
          {Array.from({ length: LOOPS }).map((_, i) => (
            <LoopDot key={i} filled={i < loopsDone} />
          ))}
        </div>
      </animated.div>

      <span className="sr-only">Loading the page.</span>
    </div>
  );
}

function LoopDot({ filled }: { filled: boolean }) {
  const style = useSpring({
    scale: filled ? 1 : 0.6,
    opacity: filled ? 1 : 0.35,
    config: { tension: 340, friction: 16 },
  });
  return (
    <animated.span
      className="block h-2 w-2 rounded-full"
      style={{
        background: filled ? "var(--accent)" : "var(--ink-soft)",
        opacity: style.opacity,
        transform: style.scale.to((s) => `scale(${s})`),
      }}
    />
  );
}
