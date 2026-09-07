import { useEffect, useState } from "react";

const MATH_CHARS = Array.from("∫ f(x) dx");
const CODE_TEXT = "const solve = (x) => { ... }";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

/**
 * The "calculus teacher → developer" visual, animated: the integral
 * writes itself in, gets crossed out, and hands off to a hand-typed
 * (uneven, human-ish) implementation. After a hold, it runs in reverse and
 * loops — all gated on the site's `data-motion` attribute, which already
 * bakes in the visitor's reduced-motion preference (see root.tsx). When
 * motion is off, this renders the plain, fully-resolved static state and
 * never animates at all.
 */
export function AnimatedEquation() {
  const [mathRevealed, setMathRevealed] = useState(MATH_CHARS.length);
  const [crossedOut, setCrossedOut] = useState(true);
  const [arrowShown, setArrowShown] = useState(true);
  const [codeRevealed, setCodeRevealed] = useState(CODE_TEXT.length);
  const [caretOn, setCaretOn] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const state = { cancelled: false, generation: 0 };

    function isMotionOn() {
      return root.getAttribute("data-motion") === "on";
    }

    function showResolved() {
      setMathRevealed(MATH_CHARS.length);
      setCrossedOut(true);
      setArrowShown(true);
      setCodeRevealed(CODE_TEXT.length);
      setCaretOn(false);
    }

    async function loop(myGen: number) {
      const stopped = () => state.cancelled || state.generation !== myGen;

      setMathRevealed(0);
      setCrossedOut(false);
      setArrowShown(false);
      setCodeRevealed(0);
      setCaretOn(true);

      while (!stopped()) {
        // Write the integral in, one character at a time, like it's being
        // sketched onto a chalkboard.
        for (let i = 1; i <= MATH_CHARS.length; i++) {
          if (stopped()) return;
          setMathRevealed(i);
          await sleep(randomBetween(55, 120));
        }

        if (stopped()) return;
        await sleep(250);

        // Draw the strike-through.
        if (stopped()) return;
        setCrossedOut(true);
        await sleep(500);

        if (stopped()) return;
        await sleep(150);
        setArrowShown(true);
        await sleep(250);

        // Type the replacement out unevenly, like a person actually typing:
        // mostly quick, occasional hesitation, a beat longer after spaces.
        for (let i = 1; i <= CODE_TEXT.length; i++) {
          if (stopped()) return;
          setCodeRevealed(i);
          const typedChar = CODE_TEXT[i - 1];
          let delay = randomBetween(35, 130);
          if (typedChar === " ") delay += randomBetween(20, 90);
          if (Math.random() < 0.1) delay += randomBetween(150, 340);
          await sleep(delay);
        }

        if (stopped()) return;
        await sleep(3000);

        // Backspace it away — faster and more even than typing, the way
        // deleting actually feels.
        for (let i = CODE_TEXT.length - 1; i >= 0; i--) {
          if (stopped()) return;
          setCodeRevealed(i);
          await sleep(randomBetween(16, 38));
        }

        if (stopped()) return;
        await sleep(150);
        setArrowShown(false);
        await sleep(250);

        if (stopped()) return;
        setCrossedOut(false);
        await sleep(500);

        // Erase the integral the same way it was written, in reverse.
        for (let i = MATH_CHARS.length - 1; i >= 0; i--) {
          if (stopped()) return;
          setMathRevealed(i);
          await sleep(randomBetween(30, 65));
        }

        if (stopped()) return;
        await sleep(700);
      }
    }

    function start() {
      state.generation += 1;
      void loop(state.generation);
    }

    if (isMotionOn()) {
      start();
    } else {
      showResolved();
    }

    const observer = new MutationObserver(() => {
      if (isMotionOn()) {
        start();
      } else {
        state.generation += 1;
        showResolved();
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-motion"] });

    return () => {
      state.cancelled = true;
      observer.disconnect();
    };
  }, []);

  const mathComplete = mathRevealed === MATH_CHARS.length;
  const codeText = CODE_TEXT.slice(0, codeRevealed);

  return (
    <div
      className="mt-6 flex flex-wrap items-center justify-center gap-3 font-mono text-lg sm:text-2xl"
      aria-hidden="true"
    >
      <span className="relative inline-block whitespace-pre rounded-lg bg-[var(--yellow)]/10 px-4 py-2 text-[var(--yellow)]">
        {MATH_CHARS.map((char, i) => (
          <span
            key={i}
            className="inline-block transition-all duration-150 ease-out"
            style={{
              opacity: i < mathRevealed ? 1 : 0,
              transform: i < mathRevealed ? "translateY(0)" : "translateY(-4px)",
            }}
          >
            {char}
          </span>
        ))}
        <span
          className="pointer-events-none absolute left-4 right-4 top-1/2 h-[2px] bg-[var(--yellow)] transition-transform duration-500 ease-in-out [transform:translateY(-50%)_scaleX(var(--cross-scale,0))] [transform-origin:left_center]"
          style={{ ["--cross-scale" as string]: mathComplete && crossedOut ? 1 : 0 }}
        />
      </span>

      <span
        className="text-[var(--text-muted)] transition-opacity duration-200"
        style={{ opacity: arrowShown ? 1 : 0 }}
      >
        →
      </span>

      <span className="relative inline-grid rounded-lg bg-[var(--cyan)]/10 px-4 py-2 text-[var(--cyan)]">
        {/* Invisible full-length text reserves the box's width/height so
            typing never reflows the layout around it. */}
        <span className="invisible whitespace-pre [grid-area:1/1]">{CODE_TEXT}</span>
        <span className="whitespace-pre [grid-area:1/1]">
          {codeText}
          <span
            className={
              "typing-caret ml-px inline-block w-[2px] translate-y-[0.1em] bg-[var(--cyan)] align-middle " +
              (caretOn ? "opacity-100" : "opacity-0")
            }
          >
            &nbsp;
          </span>
        </span>
      </span>

      <span className="sr-only">
        Calculus teacher turned developer: the integral of f of x, dx, becomes const solve = x
        goes to the solution.
      </span>
    </div>
  );
}
