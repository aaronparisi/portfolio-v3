import { useEffect, useRef, type PointerEvent } from "react";
import { animated, to, useSpring } from "@react-spring/web";
import { springValue } from "~/utils/springValue";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

// The full Gruvbox bright palette, in hue order, as concentric
// radial-gradient rings radiating from the cursor (a jawbreaker's
// actual layered-candy look), not a conic sweep. An earlier version
// used a conic gradient instead, which -- on a short, wide button
// where much of a full 360-degree wheel sits outside the visible
// bounds -- read as a gradient sliding in from one side rather than
// anything centered on the cursor.
const RAINBOW_HUES = ["#fb4934", "#fe8019", "#fabd2f", "#b8bb26", "#8ec07c", "#83a598", "#d3869b"];

/**
 * Each color gets two stops, straddling its own position -- holding
 * solid across most of the distance to its neighbors, with only a
 * narrow zone right at each boundary actually blending into the next
 * color, rather than one stop per color smoothly interpolating the
 * entire way to the next (which read as a soft gradient, not the
 * "solid rainbow rings" a jawbreaker actually has). `blendFraction` is
 * how much of the space between two colors is spent blending, vs.
 * solid -- lower reads closer to hard-edged stripes, 1 would be back
 * to the fully-smooth original.
 */
function buildJawbreakerStops(colors: string[], blendFraction: number): string {
  const sequence = [...colors, colors[0]];
  const step = 100 / (sequence.length - 1);
  const solidHalf = (step / 2) * (1 - blendFraction);
  const stops: string[] = [];
  sequence.forEach((color, i) => {
    const pos = i * step;
    stops.push(`${color} ${Math.max(0, pos - solidHalf).toFixed(1)}%`, `${color} ${Math.min(100, pos + solidHalf).toFixed(1)}%`);
  });
  return stops.join(", ");
}
const JAWBREAKER_STOPS = buildJawbreakerStops(RAINBOW_HUES, 0.25);

/**
 * The loading screen's call to action -- a from-scratch component
 * rather than an extension of SpringButton (which only ever renders
 * `<a href>` elsewhere on the site): this one needs onPointerMove
 * tracking for the rainbow hover effect and a disabled/loading visual
 * state, neither of which generalizes to SpringButton's other uses.
 *
 * While `disabled`, it shows a grayed-out, non-interactive "Loading"
 * label with a spring-driven bouncing ellipsis (see LoadingDots below)
 * instead of the real button -- once `disabled` flips false, it becomes
 * a real, clickable "Enter the site" button with the same bouncy
 * hover/press feel as SpringButton, plus a Gruvbox rainbow -- concentric
 * rings radiating from the cursor, jawbreaker-candy style -- that
 * follows it across the button.
 */
export function EnterSiteButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const reduced = usePrefersReducedMotion();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const [press, pressApi] = useSpring(() => ({ scale: 1, config: { tension: 300, friction: 12 } }));
  // The rainbow's own center position, in percent-of-button coordinates
  // -- spring-smoothed (not a direct 1:1 cursor follow) so the swirl
  // visibly chases the pointer with a little lag rather than teleporting
  // frame to frame, the same "magnetic" feel PhotoCard's tilt effect
  // uses for its own cursor tracking.
  const [glow, glowApi] = useSpring(() => ({ x: 50, y: 50, opacity: 0, config: { tension: 220, friction: 20 } }));

  function handlePointerEnter() {
    if (disabled || reduced) return;
    void pressApi.start({ scale: 1.06 });
  }
  function handlePointerLeave() {
    void pressApi.start({ scale: 1 });
    void glowApi.start({ opacity: 0 });
  }
  function handlePointerDown() {
    if (disabled || reduced) return;
    void pressApi.start({ scale: 0.94 });
  }
  function handlePointerUp() {
    if (disabled || reduced) return;
    void pressApi.start({ scale: 1.06 });
  }
  function handlePointerMove(e: PointerEvent<HTMLButtonElement>) {
    if (disabled || reduced) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    // 0.5, not 1 -- mix-blend-mode: color at full opacity replaces the
    // base's hue/saturation entirely, which combined with the accent's
    // already-bright luminance produced washed-out pastels and lost
    // the yellow accent identity completely. Partial opacity lets the
    // real accent show through underneath, so this reads as a rainbow
    // shimmer riding on top of the button rather than a full recolor.
    void glowApi.start({ x: px, y: py, opacity: 0.5 });
  }

  return (
    <animated.button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      onClick={onClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      // isolate: without it, the rainbow layer's mix-blend-mode:color
      // blends against whatever's painted behind the whole page in this
      // stacking context, not just this button's own background --
      // confirmed elsewhere on this site (the hero photo's CRT hover
      // effect) that skipping this produces a faint ghosting artifact
      // across content well outside the element itself.
      className={`relative isolate overflow-hidden rounded-full px-8 py-3 font-medium ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      style={{
        transform: press.scale.to((s) => `scale(${s})`),
        // Muted gray while loading, not just a dimmed accent -- reads
        // more clearly as "not yet interactive" than a translucent
        // yellow would (which could look like a hover/press state).
        background: disabled ? "var(--ink-soft)" : "var(--accent)",
        color: disabled ? "var(--bg)" : "var(--on-accent)",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {!disabled && (
        <animated.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: glow.opacity,
            background: to(
              [glow.x, glow.y],
              (x, y) => `radial-gradient(circle 90px at ${x}% ${y}%, ${JAWBREAKER_STOPS})`,
            ),
            // "color" (hue+saturation from this layer, luminance from
            // whatever's underneath), not "overlay" -- overlay on a
            // light, saturated base like the accent yellow leans toward
            // a "screen" lighten, which washed the rainbow's cooler
            // hues out into a vague warm glow instead of a legible
            // rainbow. "color" is the same duotone-style blend already
            // used for the hero photo's CRT hover effect, and keeps the
            // actual hues visible while still respecting the button's
            // own shading underneath.
            mixBlendMode: "color",
          }}
        />
      )}
      <span className="relative inline-flex items-center gap-2">
        {disabled ? (
          <>
            Loading
            <LoadingDots />
          </>
        ) : (
          "Enter the site"
        )}
      </span>
    </animated.button>
  );
}

const DOT_STAGGER_S = 0.15; // stagger between dots, so the bounce ripples across them as a wave
// Rise is slower than fall on purpose -- gravity should read as *pulling
// it back down*, not just an identical reversal of the same motion.
// Fall's lower friction relative to its tension gives it a small,
// natural-feeling settle on landing rather than stopping dead.
const DOT_RISE_S = 0.38;
const DOT_FALL_S = 0.32;
const DOT_REST_S = 0.42;
const DOT_PEAK_HEIGHT = -10; // px, how high each dot rises above rest

// Three dots bouncing in a staggered wave, each one only ever resting
// at the bottom between hops (never mid-air) -- gravity, not a
// pendulum. Driven by springValue() (see ~/utils/springValue) inside a
// plain requestAnimationFrame loop -- the same technique the 3D loading
// graph uses for its own animation, not react-spring. That's not just
// consistency for its own sake: react-spring produced two real bugs
// trying to do this exact thing, and this page is a uniquely hostile
// environment for exactly the kind of timing assumption both bugs made,
// since the 3D loading graph is *also* running concurrently, competing
// hard for the same main thread and stalling it in irregular bursts.
//
// - useTrail wires each item to follow the next one's value (that's
//   the whole point of a "trail"), which fought this component's own
//   per-item async while(true) loops hard enough to recurse
//   react-spring's fluid-observer graph into a genuine stack overflow
//   (RangeError: Maximum call stack size exceeded), confirmed happening
//   on page load well before any hover interaction, timed to right when
//   the dots start their first cycle. This one's independent of the
//   thread-stall issue below -- it's useTrail's own inter-item linking.
//
// - Switching to useSprings (no inter-item linking) fixed the crash,
//   but dots 1 and 2 then animated in perfect lockstep despite
//   different stagger delays -- confirmed at the source level (not a
//   DOM query artifact: timestamped logging inside each closure showed
//   both firing their "rise" at the identical millisecond). Splitting
//   each dot into a fully independent component with its own
//   useSpring didn't fix it either -- same lockstep. The actual root
//   cause turned up while building *this* version instead: a naive
//   requestAnimationFrame loop that snaps its phase's start time to
//   "now" on every transition has the identical failure mode --
//   confirmed by logging the raw internal state every tick, where two
//   dots' `t` values (time since their current phase started)
//   converged to the same number within a few ticks despite their
//   independently-tracked absolute elapsed times staying correctly
//   ~120ms apart the whole time. The likely mechanism in both cases:
//   whenever the main thread stalls for a stretch (which happens
//   constantly here) and several dots' pending timers/ticks all become
//   ready during that same stall, "snap to now" loses however far
//   apart they actually were the instant they're forced to catch up
//   together. The fix below (advance by the phase's actual *duration*
//   each time, in a loop, until caught up -- never snap to "now")
//   preserves the real stagger through stalls of any length, which is
//   also just a more correct simulation regardless of what's sharing
//   the thread.
function LoadingDots() {
  return (
    <span className="inline-flex items-end gap-1" aria-hidden="true">
      <Dot delaySeconds={0} />
      <Dot delaySeconds={DOT_STAGGER_S} />
      <Dot delaySeconds={DOT_STAGGER_S * 2} />
    </span>
  );
}

function Dot({ delaySeconds }: { delaySeconds: number }) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    let disposed = false;
    const startTime = performance.now();
    let phase: "rise" | "fall" | "rest" = "rise";
    let phaseStart = 0;

    function tick() {
      if (disposed || !el) return;
      const elapsed = (performance.now() - startTime) / 1000 - delaySeconds;
      if (elapsed >= 0) {
        // Catch up through as many phase transitions as elapsed time
        // demands, not just one per tick -- the 3D loading graph running
        // concurrently on the same page competes hard for the main
        // thread, so a tick can genuinely land more than one phase's
        // duration past the last time this ran. Advancing only one
        // phase per call in that case leaves the state machine
        // perpetually behind real time -- and, worse, since every dot
        // on screen stalls on the *same* main-thread gaps, all of them
        // "catch up" through the identical sequence of single-phase
        // advances afterward and end up visibly synchronized despite
        // their different stagger delays. Confirmed by logging the
        // raw internal state every tick: the three dots' `t` values
        // (time-since-this-phase-started) converged to the same
        // number within a few ticks even though their independently-
        // tracked `elapsed` (time-since-this-dot's-own-start) stayed
        // correctly ~120ms apart the whole time -- the desync was
        // entirely in phaseStart snapping to "now" on a transition
        // instead of advancing by the phase's actual duration.
        let t = elapsed - phaseStart;
        while (true) {
          const duration = phase === "rise" ? DOT_RISE_S : phase === "fall" ? DOT_FALL_S : DOT_REST_S;
          if (t <= duration) break;
          phaseStart += duration;
          t -= duration;
          phase = phase === "rise" ? "fall" : phase === "fall" ? "rest" : "rise";
        }
        const y =
          phase === "rise"
            ? springValue(t, 0, DOT_PEAK_HEIGHT, 145, 16)
            : phase === "fall"
              ? springValue(t, DOT_PEAK_HEIGHT, 0, 300, 19)
              : 0;
        el.style.transform = `translate3d(0, ${y}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [reduced, delaySeconds]);

  return <span ref={ref} className="inline-block h-1.5 w-1.5 rounded-full bg-current" />;
}
