import { useEffect, useState } from "react";
import { animated, useSprings, useSpring } from "@react-spring/web";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const MATH_CHARS = Array.from("∫ f(x) dx");
const CODE_TEXT = "const solve = (x) => { ... }";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

// A confident, no-overshoot settle — used for anything that should look
// "drawn" or "typed" rather than sprung into place.
const DRAW_CONFIG = { tension: 300, friction: 26 };
// Low friction relative to its tension so the CRT screen visibly
// overshoots past full size before settling back — the spring-physics
// equivalent of the old cubic-bezier(0.34, 1.56, 0.64, 1) back-ease.
const BOOT_CONFIG = { tension: 300, friction: 14 };
// No overshoot on the way down — a screen doesn't bounce as it turns off.
const SHUTDOWN_CONFIG = { tension: 300, friction: 32 };
const CARET_CONFIG = { tension: 420, friction: 30 };

/**
 * The "calculus teacher → developer" story, animated: the integral
 * draws itself in on a chalkboard, gets crossed out, and hands off to a
 * hand-typed (uneven, human-ish, occasionally-typo'd) implementation on
 * a CRT-style screen that boots up and powers down around it. Loops,
 * gated on prefers-reduced-motion (immediate: true on every spring —
 * settles straight to whichever state without a single animated frame).
 */
export function AnimatedEquation() {
  const reduced = usePrefersReducedMotion();

  const [mathRevealed, setMathRevealed] = useState(0);
  const [crossedOut, setCrossedOut] = useState(false);
  const [arrowShown, setArrowShown] = useState(false);
  const [codeRevealed, setCodeRevealed] = useState(0);
  // Set only during the occasional typo dance below, to show text that
  // isn't a prefix of CODE_TEXT (e.g. "cosnt"). null the rest of the
  // time, when codeRevealed's slice of CODE_TEXT is what's shown.
  const [codeOverride, setCodeOverride] = useState<string | null>(null);
  const [caretShape, setCaretShape] = useState<"hidden" | "underscore" | "block">("hidden");
  const [caretBlinking, setCaretBlinking] = useState(false);
  // The screen itself "boots up" and "powers down", independent of
  // what's happening inside it.
  const [boxPower, setBoxPower] = useState<"off" | "on">("off");
  const [bootConfig, setBootConfig] = useState(BOOT_CONFIG);

  useEffect(() => {
    const state = { cancelled: false, generation: 0 };

    async function typeConstTypo(): Promise<number | null> {
      const typo = "cosnt";
      for (let i = 1; i <= typo.length; i++) {
        if (stopped()) return null;
        setCodeOverride(typo.slice(0, i));
        await sleep(randomBetween(25, 96));
      }

      if (stopped()) return null;
      await sleep(randomBetween(280, 480)); // notice the mistake

      for (let i = typo.length - 1; i >= 2; i--) {
        if (stopped()) return null;
        setCodeOverride(typo.slice(0, i));
        await sleep(randomBetween(20, 46));
      }

      if (stopped()) return null;
      await sleep(randomBetween(150, 300)); // beat before retyping

      setCodeOverride(null);
      setCodeRevealed(2); // "co" already matches CODE_TEXT's real prefix
      return 3;
    }

    const stopped = () => state.cancelled;

    async function loop(myGen: number) {
      const stillCurrent = () => !state.cancelled && state.generation === myGen;

      setMathRevealed(0);
      setCrossedOut(false);
      setArrowShown(false);
      setBoxPower("off");
      setCodeRevealed(0);
      setCodeOverride(null);
      setCaretShape("hidden");
      setCaretBlinking(false);

      let runIndex = 0;

      while (stillCurrent()) {
        await sleep(500);
        for (let i = 1; i <= MATH_CHARS.length; i++) {
          if (!stillCurrent()) return;
          setMathRevealed(i);
          await sleep(randomBetween(65, 140));
        }

        if (!stillCurrent()) return;
        await sleep(500);
        setCrossedOut(true);
        await sleep(600);

        if (!stillCurrent()) return;
        await sleep(350);
        setArrowShown(true);
        await sleep(350);

        if (!stillCurrent()) return;
        setCaretShape("underscore");
        setBootConfig(BOOT_CONFIG);
        setBoxPower("on");
        await sleep(420);

        if (!stillCurrent()) return;
        await sleep(200);
        setCaretShape("block");
        await sleep(140);

        if (!stillCurrent()) return;
        setCaretBlinking(true);
        await sleep(1500);

        let typeFrom = 1;
        if (runIndex % 3 === 0) {
          if (!stillCurrent()) return;
          const resumeFrom = await typeConstTypo();
          if (resumeFrom === null) return;
          typeFrom = resumeFrom;
        }

        for (let i = typeFrom; i <= CODE_TEXT.length; i++) {
          if (!stillCurrent()) return;
          setCodeRevealed(i);
          const typedChar = CODE_TEXT[i - 1];
          let delay = randomBetween(25, 96);
          if (typedChar === " ") delay += randomBetween(15, 66);
          if (Math.random() < 0.1) delay += randomBetween(115, 245);
          await sleep(delay);
        }

        runIndex += 1;

        if (!stillCurrent()) return;
        await sleep(3400);

        for (let i = CODE_TEXT.length - 1; i >= 0; i--) {
          if (!stillCurrent()) return;
          setCodeRevealed(i);
          await sleep(randomBetween(20, 46));
        }

        if (!stillCurrent()) return;
        await sleep(1500);
        setCaretBlinking(false);
        setCaretShape("hidden");
        await sleep(300);

        if (!stillCurrent()) return;
        await sleep(250);
        setBootConfig(SHUTDOWN_CONFIG);
        setBoxPower("off");
        await sleep(320);

        if (!stillCurrent()) return;
        setArrowShown(false);
        await sleep(450);

        if (!stillCurrent()) return;
        setCrossedOut(false);
        await sleep(600);

        if (!stillCurrent()) return;
        await sleep(500);
        for (let i = MATH_CHARS.length - 1; i >= 0; i--) {
          if (!stillCurrent()) return;
          setMathRevealed(i);
          await sleep(randomBetween(38, 80));
        }

        if (!stillCurrent()) return;
        await sleep(850);
      }
    }

    function showResolved() {
      setMathRevealed(MATH_CHARS.length);
      setCrossedOut(true);
      setArrowShown(true);
      setBoxPower("on");
      setCodeRevealed(CODE_TEXT.length);
      setCodeOverride(null);
      setCaretShape("hidden");
      setCaretBlinking(false);
    }

    if (reduced) {
      showResolved();
      return () => {
        state.cancelled = true;
      };
    }

    state.generation += 1;
    void loop(state.generation);
    return () => {
      state.cancelled = true;
    };
  }, [reduced]);

  const mathComplete = mathRevealed === MATH_CHARS.length;
  const codeText = codeOverride ?? CODE_TEXT.slice(0, codeRevealed);

  const mathSprings = useSprings(
    MATH_CHARS.length,
    MATH_CHARS.map((_, i) => ({
      opacity: i < mathRevealed ? 1 : 0,
      y: i < mathRevealed ? 0 : -6,
      immediate: reduced,
      config: DRAW_CONFIG,
    })),
  );

  const crossOut = useSpring({
    scaleX: mathComplete && crossedOut ? 1 : 0,
    immediate: reduced,
    config: DRAW_CONFIG,
  });

  const arrow = useSpring({
    opacity: arrowShown ? 1 : 0,
    immediate: reduced,
    config: { tension: 250, friction: 26 },
  });

  const box = useSpring({
    scaleY: boxPower === "on" ? 1 : 0,
    immediate: reduced,
    config: bootConfig,
  });

  const caret = useSpring({
    scale: caretShape === "block" ? 1 : caretShape === "underscore" ? 0.15 : 0,
    immediate: reduced,
    config: CARET_CONFIG,
  });

  return (
    <div className="flex flex-wrap items-center gap-3 font-mono text-lg" aria-hidden="true">
      <span
        className="relative inline-block whitespace-pre rounded-2xl px-4 py-2"
        style={{ background: "var(--board)", color: "var(--chalk)" }}
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
          className="pointer-events-none absolute left-4 right-4 top-1/2 h-[2px]"
          style={{
            background: "var(--accent-warm)",
            transform: crossOut.scaleX.to((s) => `translateY(-50%) scaleX(${s})`),
            transformOrigin: "left center",
          }}
        />
      </span>

      <animated.span style={{ opacity: arrow.opacity }} className="text-[var(--ink-soft)]">
        →
      </animated.span>

      <animated.span
        className="relative inline-grid rounded-2xl px-4 py-2 text-left"
        style={{
          background: "var(--board)",
          color: "var(--accent)",
          transform: box.scaleY.to((s) => `scaleY(${s})`),
        }}
      >
        {/* Invisible full-length text plus a same-sized caret spacer
            reserves the box's final width/height up front, so typing
            never reflows the layout and the box doesn't grow when the
            caret appears at the end. */}
        <span className="invisible whitespace-pre [grid-area:1/1]">
          {CODE_TEXT}
          <span className="ml-0.5 inline-block h-[1em] w-[0.55em] align-middle" />
        </span>
        <span className="whitespace-pre [grid-area:1/1]">
          {codeText}
          <animated.span
            className={`ml-0.5 inline-block h-[1em] w-[0.55em] align-middle ${caretBlinking ? "typing-caret" : ""}`}
            style={{
              background: "var(--accent)",
              transform: caret.scale.to((s) => `translateY(-0.15em) scaleY(${s})`),
              transformOrigin: "bottom",
            }}
          />
        </span>
      </animated.span>

      <span className="sr-only">
        Calculus teacher turned developer: the integral of f of x, dx, becomes const solve = x
        goes to the solution.
      </span>
    </div>
  );
}
