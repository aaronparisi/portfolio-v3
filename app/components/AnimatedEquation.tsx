import { useEffect, useState } from "react";

const MATH_CHARS = Array.from("∫ f(x) dx");
const CODE_TEXT = "const solve = (x) => { ... }";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

// Waits for a frame to actually paint. Used to force a no-transition reset
// to be committed to the screen before transitions are switched back on,
// so the reset itself never plays as a (backwards-looking) animation.
function nextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
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
  // Starts from nothing — both because that's the first frame of the
  // animated sequence, and because it means there's no "resolved" flash to
  // clean up before the real first paint even for motion-off visitors
  // (showResolved below still snaps them to the finished state, just from
  // blank rather than from a flash of it).
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
  // The code pill itself "boots up" and "powers down" like an old monitor,
  // independent of what's happening inside it.
  const [boxPower, setBoxPower] = useState<"off" | "on">("off");
  // True only for the instant a loop (re)starts and resets to blank — every
  // transition is suppressed while it's on, so that reset can never itself
  // play as a visible (backwards-looking) animation.
  const [instant, setInstant] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const state = { cancelled: false, generation: 0 };

    function isMotionOn() {
      return root.getAttribute("data-motion") === "on";
    }

    function showResolved() {
      // Snaps straight to the finished state with transitions suppressed —
      // reduced-motion visitors should never see so much as a fade.
      setInstant(true);
      setMathRevealed(MATH_CHARS.length);
      setCrossedOut(true);
      setArrowShown(true);
      setBoxPower("on");
      setCodeRevealed(CODE_TEXT.length);
      setCodeOverride(null);
      setCaretShape("hidden");
      setCaretBlinking(false);
      void nextPaint().then(() => setInstant(false));
    }

    async function loop(myGen: number) {
      const stopped = () => state.cancelled || state.generation !== myGen;

      // Types through a mistake ("cosnt" — "n" and "s" transposed),
      // pauses as if noticing it, backspaces to the wrong point, and
      // retypes correctly, the way an actual typo actually happens
      // rather than simply never occurring. Returns the CODE_TEXT index
      // to resume normal typing from (codeRevealed is already correct up
      // to that point), or null if the animation was stopped mid-typo.
      async function typeConstTypo(): Promise<number | null> {
        const typo = "cosnt";
        for (let i = 1; i <= typo.length; i++) {
          if (stopped()) return null;
          setCodeOverride(typo.slice(0, i));
          await sleep(randomBetween(25, 96));
        }

        if (stopped()) return null;
        await sleep(randomBetween(280, 480)); // notice the mistake

        // Backspace back to "co" — where it actually went wrong.
        for (let i = typo.length - 1; i >= 2; i--) {
          if (stopped()) return null;
          setCodeOverride(typo.slice(0, i));
          await sleep(randomBetween(20, 46));
        }

        if (stopped()) return null;
        await sleep(randomBetween(150, 300)); // beat before retyping

        setCodeOverride(null);
        setCodeRevealed(2); // "co" already matches CODE_TEXT's real prefix
        return 3; // resume normal typing from the 3rd character onward
      }

      // Reset to a totally blank slate with transitions suppressed, so
      // this reset is a hard cut rather than a visible "unwind" of
      // whatever was on screen a moment ago (e.g. the resolved static
      // state shown before this effect had a chance to run).
      setInstant(true);
      setMathRevealed(0);
      setCrossedOut(false);
      setArrowShown(false);
      setBoxPower("off");
      setCodeRevealed(0);
      setCodeOverride(null);
      setCaretShape("hidden");
      setCaretBlinking(false);
      await nextPaint();
      if (stopped()) return;
      setInstant(false);

      // Every third run (including the very first) plays out a small
      // typo in "const" — caught and corrected — rather than typing
      // clean every time.
      let runIndex = 0;

      while (!stopped()) {
        // A beat on the blank page before anything starts.
        await sleep(500);

        // Write the integral in, one character at a time, like it's being
        // sketched onto a chalkboard.
        for (let i = 1; i <= MATH_CHARS.length; i++) {
          if (stopped()) return;
          setMathRevealed(i);
          await sleep(randomBetween(65, 140));
        }

        if (stopped()) return;
        await sleep(500);

        // Draw the strike-through.
        setCrossedOut(true);
        await sleep(600);

        if (stopped()) return;
        await sleep(350);

        // The arrow, then the screen boots up, then the cursor — each one
        // waits for the last to settle before it shows up.
        setArrowShown(true);
        await sleep(350);

        // The cursor warms up like a real terminal one: it's already a
        // thin underscore by the time the screen starts booting up (the
        // way a prompt is already there as an old monitor comes on, not
        // something that pops in only once the screen has finished), sits
        // for a moment once booted, then quickly grows into a full block
        // before it starts blinking.
        if (stopped()) return;
        setCaretShape("underscore");
        setBoxPower("on");
        await sleep(420); // let the screen finish booting up

        if (stopped()) return;
        await sleep(200); // sit as an underscore a moment longer

        if (stopped()) return;
        setCaretShape("block");
        await sleep(140); // let it expand — quick

        if (stopped()) return;
        setCaretBlinking(true);
        await sleep(1500); // blink once or twice before typing begins

        // Type the replacement out unevenly, like someone typing with all
        // ten fingers rather than two: mostly quick, occasional
        // hesitation, a beat longer after spaces. Every third run (this
        // one included, when runIndex is 0) opens with a real typo —
        // "cosnt" caught and corrected back to "const" — before typing
        // continues normally.
        let typeFrom = 1;
        if (runIndex % 3 === 0) {
          if (stopped()) return;
          const resumeFrom = await typeConstTypo();
          if (resumeFrom === null) return; // stopped mid-typo
          typeFrom = resumeFrom;
        }

        for (let i = typeFrom; i <= CODE_TEXT.length; i++) {
          if (stopped()) return;
          setCodeRevealed(i);
          const typedChar = CODE_TEXT[i - 1];
          let delay = randomBetween(25, 96);
          if (typedChar === " ") delay += randomBetween(15, 66);
          if (Math.random() < 0.1) delay += randomBetween(115, 245);
          await sleep(delay);
        }

        runIndex += 1;

        if (stopped()) return;
        await sleep(3400);

        // Backspace it away — faster and more even than typing, the way
        // deleting actually feels.
        for (let i = CODE_TEXT.length - 1; i >= 0; i--) {
          if (stopped()) return;
          setCodeRevealed(i);
          await sleep(randomBetween(20, 46));
        }

        if (stopped()) return;
        await sleep(1500); // blink once or twice before the cursor leaves

        setCaretBlinking(false);
        setCaretShape("hidden");
        await sleep(300); // let it retract

        if (stopped()) return;
        await sleep(250);
        setBoxPower("off");
        await sleep(320); // let the screen finish powering down

        if (stopped()) return;
        setArrowShown(false);
        await sleep(450);

        if (stopped()) return;
        setCrossedOut(false);
        await sleep(600);

        if (stopped()) return;
        await sleep(500);

        // Erase the integral the same way it was written, in reverse.
        for (let i = MATH_CHARS.length - 1; i >= 0; i--) {
          if (stopped()) return;
          setMathRevealed(i);
          await sleep(randomBetween(38, 80));
        }

        if (stopped()) return;
        await sleep(850);
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
  const codeText = codeOverride ?? CODE_TEXT.slice(0, codeRevealed);

  return (
    <div
      className={
        "mt-6 flex flex-wrap items-center justify-center gap-3 font-mono text-lg sm:text-2xl" +
        (instant ? " anim-instant" : "")
      }
      aria-hidden="true"
    >
      <span className="chalkboard relative inline-block whitespace-pre rounded-lg px-4 py-2 text-[var(--base2)]">
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
          className="pointer-events-none absolute left-4 right-4 top-1/2 h-[2px] bg-[var(--base2)] transition-transform duration-[600ms] ease-in-out [transform:translateY(-50%)_scaleX(var(--cross-scale,0))] [transform-origin:left_center]"
          style={{ ["--cross-scale" as string]: mathComplete && crossedOut ? 1 : 0 }}
        />

        {/* The eraser tray — pure scenery, hanging off the bottom edge. */}
        <span
          aria-hidden="true"
          className="chalk-tray pointer-events-none absolute -bottom-2.5 left-2 right-2 h-2 rounded-[1px]"
        >
          <span className="absolute -top-1.5 left-1.5 h-1.5 w-4 rounded-[1px] bg-[var(--chalk-stick)]" />
          <span className="absolute -top-1.5 left-6 h-1.5 w-4 rounded-[1px] bg-[var(--chalk-stick)]" />
          <span className="absolute -top-2 right-1.5 h-2 w-5 rounded-[1px] bg-[var(--chalk-eraser)]" />
        </span>
      </span>

      <span
        className="text-[var(--text-muted)] transition-opacity duration-200"
        style={{ opacity: arrowShown ? 1 : 0 }}
      >
        →
      </span>

      <span
        className={
          "relative inline-grid rounded-lg bg-[var(--cyan)]/10 px-4 py-2 text-left text-[var(--cyan)] " +
          (boxPower === "on"
            ? "duration-[420ms] [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]"
            : "duration-[260ms] ease-in") +
          " transition-transform"
        }
        style={{ transform: boxPower === "on" ? "scaleY(1)" : "scaleY(0)" }}
      >
        {/* Invisible full-length text plus a same-sized caret spacer
            reserves the box's final width/height up front, so typing never
            reflows the layout and the box doesn't grow when the caret
            appears at the end. */}
        <span className="invisible whitespace-pre [grid-area:1/1]">
          {CODE_TEXT}
          <span className="ml-0.5 inline-block h-[1em] w-[0.55em] align-middle" />
        </span>
        <span className="whitespace-pre [grid-area:1/1]">
          {codeText}
          <span
            className={
              "ml-0.5 inline-block h-[1em] w-[0.55em] bg-[var(--cyan)] align-middle will-change-transform transition-transform duration-125 ease-out [transform-origin:bottom] [transform:translateY(-0.15em)_scaleY(var(--caret-scale,0))]" +
              (caretBlinking ? " typing-caret" : "")
            }
            style={{
              ["--caret-scale" as string]:
                caretShape === "block" ? 1 : caretShape === "underscore" ? 0.15 : 0,
            }}
          />
        </span>
      </span>

      <span className="sr-only">
        Calculus teacher turned developer: the integral of f of x, dx, becomes const solve = x
        goes to the solution.
      </span>
    </div>
  );
}
