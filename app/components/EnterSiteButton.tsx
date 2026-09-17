import { useEffect, useRef, useState, type PointerEvent } from "react";
import { animated, to, useSpring } from "@react-spring/web";
import { springValue } from "~/utils/springValue";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

// The rainbow rings (everything but the center) -- winds outward from
// right next to the cursor through the rest of the Gruvbox bright
// palette, then fades to transparent rather than wrapping back to its
// first color: an explicit CSS radial-gradient size (see
// JAWBREAKER_RADIUS_PX below) paints its *last* stop as a solid fill
// for the entire rest of the element beyond that radius, so a
// wrap-to-first-color ending meant nearly the whole button --
// everywhere further than the radius from the cursor -- was actually
// a solid wash of that last color, not localized to the cursor at
// all. That's what read as the button "turning tan": the gradient's
// final color (previously red, wrapped from the first stop) was
// silently flooding the whole background outside a small circle.
// Fading to transparent instead means anywhere outside the ring
// pattern shows the real, unblended accent yellow underneath.
const RING_COLORS = ["#fe8019", "#fabd2f", "#b8bb26", "#8ec07c", "#83a598", "#d3869b", "transparent"];

/**
 * Each color gets two stops, straddling its own position -- holding
 * solid across most of the distance to its neighbors, with only a
 * narrow zone right at each boundary actually blending into the next
 * color, rather than one stop per color smoothly interpolating the
 * entire way to the next (which read as a soft gradient, not the
 * "solid rainbow rings" a jawbreaker actually has). `blendFraction` is
 * how much of the space between two colors is spent blending, vs.
 * solid -- lower reads closer to hard-edged stripes.
 */
function buildJawbreakerStops(sequence: string[], blendFraction: number): string {
  const step = 100 / (sequence.length - 1);
  const solidHalf = (step / 2) * (1 - blendFraction);
  const stops: string[] = [];
  sequence.forEach((color, i) => {
    const pos = i * step;
    stops.push(`${color} ${Math.max(0, pos - solidHalf).toFixed(1)}%`, `${color} ${Math.min(100, pos + solidHalf).toFixed(1)}%`);
  });
  return stops.join(", ");
}
const JAWBREAKER_STOPS = buildJawbreakerStops(RING_COLORS, 0.25);
// Shrunk from the original 90px -- at that size the rings read as
// large enough to dominate the whole (fairly small) button rather
// than a tight jawbreaker centered right on the cursor.
const JAWBREAKER_RADIUS_PX = 55;

// The center disc is deliberately a *separate* layer from the rings
// above, rendered with ordinary alpha compositing instead of
// mix-blend-mode: color. That's not a style inconsistency -- it's the
// only way to make it actually read as its true color. mix-blend-mode:
// color locks the result's luminance to whatever's underneath, and the
// accent yellow backdrop is bright enough that *any* hue rendered
// through it that way comes out pale and washed -- confirmed directly
// against the browser's own compositor (a canvas with
// globalCompositeOperation: "color", not just a guess from the spec):
// blue over this exact yellow at full opacity comes out rgb(169,203,190),
// a pale mint, and at the 0.5 opacity the rings use it's rgb(210,196,119)
// -- textbook "tan". No amount of retuning blend-mode opacity fixes
// that; it's a ceiling built into the blend mode itself against a
// backdrop this bright. Plain alpha blending at high opacity doesn't
// have that ceiling -- so the center gets its own normal-blend layer
// on top of the ring layer, sized just big enough to fully cover the
// rings' own color at position 0 (which no longer matters what it is).
const CENTER_COLOR = "#fb4934";
const CENTER_RADIUS_PX = 16;
const CENTER_FADE_PX = 10;

// The one-shot transition that plays when the button flips from
// disabled to enabled: a diagonal band of Gruvbox colors sweeps left
// to right, with solid accent yellow trailing behind it and the
// disabled tan still showing ahead of it (wherever the sweep hasn't
// reached yet) -- like the band is repainting the button as it
// passes, rather than a plain crossfade.
//
// Built as a single element containing two children -- a big solid
// block of yellow, followed by a narrow strip of striped colors --
// both riding inside one skewX()'d, translateX()'d container. Skewing
// the *container* rather than hand-computing a diagonal clip-path
// polygon means both the yellow's leading edge and the stripe band's
// internal edges tilt together automatically, from plain vertical
// stripes in the container's own local coordinates.
//
// Sized and positioned entirely in the parent button's own terms --
// `calc(100% + ...)` for width and a plain -100%/0% translateX range
// -- rather than measuring the button's pixel width in JS, so this
// doesn't need a ref or a resize observer to stay correct if the
// button's size ever changes.
const WIPE_SKEW_DEG = -16;
// However large the skew shear ends up being at this button's actual
// height, WIPE_MARGIN_PX just needs to safely exceed it so the leading
// and trailing edges stay fully off-canvas (start) or fully past both
// corners (end) rather than clipping a sliver of the wrong color at
// the top or bottom -- comfortably oversized for any height this
// button is likely to be.
const WIPE_MARGIN_PX = 32;
const WIPE_STRIPE_COLORS = ["#fb4934", "#fe8019", "#fabd2f", "#b8bb26", "#8ec07c", "#83a598", "#d3869b"];
const WIPE_STRIPE_PX = 7; // width of each individual color stripe
const WIPE_BRUSH_PX = WIPE_STRIPE_COLORS.length * WIPE_STRIPE_PX; // the band shows exactly one pass of the full palette
const WIPE_BRUSH_GRADIENT = `repeating-linear-gradient(90deg, ${WIPE_STRIPE_COLORS.map((c, i) => `${c} ${i * WIPE_STRIPE_PX}px ${(i + 1) * WIPE_STRIPE_PX}px`).join(", ")})`;
// Split into two very different-feeling stretches rather than one
// continuous motion the whole time: a long HOLD where the sweep barely
// moves at all -- as if the disabled tan is a spring pulled taut and
// held -- followed by a short, underdamped SNAP where it actually
// releases and covers essentially the whole distance, landing with a
// small overshoot-and-settle wobble (the "springiness"). A single
// smooth spring release naturally has its highest velocity roughly
// 1/omega0 into its own motion -- i.e., fairly early relative to its
// own duration, not at the very end -- so a plain one-phase spring
// stretched across the full 2.2s would spend most of that time
// decelerating, not accelerating. Concentrating virtually all of the
// visible motion into a short burst *after* a long static hold is what
// actually reads as "released, then fast," while HOLD + SNAP still
// adds up to the same 2.2s total as the single-phase version before it.
const WIPE_HOLD_S = 1.5;
const WIPE_SNAP_S = 0.7;
const WIPE_SNAP_TENSION = 90;
const WIPE_SNAP_FRICTION = 9;
const WIPE_DURATION_S = WIPE_HOLD_S + WIPE_SNAP_S;

/**
 * Plays the enable transition's sweep once on mount, then calls
 * `onDone`. Driven by a plain requestAnimationFrame loop evaluating
 * springValue() directly (see ~/utils/springValue) rather than
 * react-spring's useSpring -- not for the dots' lockstep reasons this
 * time, but because react-spring's onRest firing needs its own rest
 * detection to pass first, and that turned out to lag well behind
 * when this exact spring is visibly settled (confirmed directly:
 * background-color sampling after triggering this transition showed
 * the solid-yellow handoff arriving ~1.9s after the sweep started, on
 * a spring whose curve is ~99% resolved by 0.65s). Whatever's driving
 * wipeDone needs to fire close to when the sweep actually *looks*
 * done, since it's what hands the button's own background off from
 * the animated sweep to a plain solid yellow -- a callback that lags
 * a second or more behind would leave the button visibly stuck mid-
 * transition. A fixed-duration rAF loop has no such lag: it calls
 * onDone the instant its own known-in-advance duration elapses.
 */
function WipeSweep({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      onDoneRef.current();
      return;
    }
    let raf = 0;
    let disposed = false;
    const startTime = performance.now();

    function tick() {
      if (disposed || !el) return;
      const t = (performance.now() - startTime) / 1000;
      if (t >= WIPE_DURATION_S) {
        el.style.transform = `translateX(0%) skewX(${WIPE_SKEW_DEG}deg)`;
        onDoneRef.current();
        return;
      }
      // springValue itself already returns exactly `from` (0 here) for
      // any t <= 0, so feeding it negative time during the hold -- no
      // special-casing needed -- keeps the sweep motionless until the
      // snap actually begins at t = WIPE_HOLD_S.
      const p = springValue(t - WIPE_HOLD_S, 0, 1, WIPE_SNAP_TENSION, WIPE_SNAP_FRICTION);
      el.style.transform = `translateX(${(p - 1) * 100}%) skewX(${WIPE_SKEW_DEG}deg)`;
      raf = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
    // Runs exactly once per mount -- this component is only ever
    // mounted for the duration of one sweep, not kept around and
    // re-triggered, so onDone is read via a ref rather than listed
    // here (its identity can change across the parent's own re-renders
    // without restarting the sweep).
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0"
      // The initial transform matches tick()'s own t=0 value exactly
      // -- without it, this would render one frame with no transform
      // at all (fully covering, untranslated) before the effect's
      // first rAF callback ever runs, flashing solid yellow for a
      // frame before the sweep starts.
      style={{
        left: `${-WIPE_MARGIN_PX}px`,
        width: `calc(100% + ${2 * WIPE_MARGIN_PX + WIPE_BRUSH_PX}px)`,
        transform: `translateX(-100%) skewX(${WIPE_SKEW_DEG}deg)`,
      }}
    >
      <span className="absolute inset-y-0 left-0" style={{ width: `calc(100% - ${WIPE_BRUSH_PX}px)`, background: "var(--accent)" }} />
      <span className="absolute inset-y-0 right-0" style={{ width: `${WIPE_BRUSH_PX}px`, backgroundImage: WIPE_BRUSH_GRADIENT }} />
    </span>
  );
}

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
  // Whether the enable transition has finished painting the button
  // yellow -- kept separate from `disabled` itself so the background
  // can keep showing the disabled tan for the wipe overlay (see
  // WipeSweep below) to sweep across, instead of snapping straight to
  // yellow underneath it the instant `disabled` flips (which would
  // make the whole wipe invisible -- there'd be nothing left for it to
  // reveal).
  const [wipeDone, setWipeDone] = useState(disabled ? false : true);
  const wasDisabled = useRef(disabled);

  useEffect(() => {
    if (wasDisabled.current && !disabled) {
      if (reduced) {
        // No sweep to watch, so nothing to gate on -- go straight there.
        setWipeDone(true);
      } else {
        // The "pop": a bigger, bouncier version of the hover scale
        // bump, released back down after a fixed delay instead of
        // chained via react-spring's own async next()/onRest --
        // confirmed directly (see WipeSweep's own comment) that
        // react-spring's rest detection is precise enough to add most
        // of a second beyond when a spring is visually settled, which
        // would make the "bounce back" half of the pop start visibly
        // later than the eye expects. A plain timeout tuned to when
        // this specific spring configuration actually *looks* settled
        // doesn't have that lag.
        void pressApi.start({ scale: 1.18, config: { tension: 260, friction: 9 } });
        const popBackId = window.setTimeout(() => {
          void pressApi.start({ scale: 1, config: { tension: 300, friction: 14 } });
        }, 260);
        setWipeDone(false);
        return () => window.clearTimeout(popBackId);
      }
    }
    wasDisabled.current = disabled;
  }, [disabled, reduced, pressApi]);

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
        // Gated on wipeDone, not just `disabled` -- see wipeDone's own
        // comment above for why the enable transition needs the base
        // to keep showing tan a little longer than the button's
        // actual functional disabled state.
        background: wipeDone ? "var(--accent)" : "var(--ink-soft)",
        color: wipeDone ? "var(--on-accent)" : "var(--bg)",
        // Opacity, unlike background/color, follows `disabled` directly
        // and snaps immediately -- it's part of the "pop" moment, not
        // the wipe's own slower reveal.
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {!disabled && !wipeDone && !reduced && <WipeSweep onDone={() => setWipeDone(true)} />}
      {!disabled && (
        <animated.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: glow.opacity,
            background: to(
              [glow.x, glow.y],
              (x, y) => `radial-gradient(circle ${JAWBREAKER_RADIUS_PX}px at ${x}% ${y}%, ${JAWBREAKER_STOPS})`,
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
      {!disabled && (
        <animated.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            // Scaled up from the ring layer's own opacity rather than
            // an independent spring -- keeps the two layers' fade
            // in/out timing on hover enter/leave identical, while
            // still reaching a much higher peak opacity than the
            // rings do. See CENTER_COLOR's comment above for why this
            // layer needs to be this much more opaque: ordinary alpha
            // blending needs to get *that* opaque before blue reads as
            // blue rather than yellow-tinted teal.
            opacity: glow.opacity.to((o) => Math.min(1, o * 1.8)),
            background: to(
              [glow.x, glow.y],
              (x, y) =>
                `radial-gradient(circle ${CENTER_RADIUS_PX + CENTER_FADE_PX}px at ${x}% ${y}%, ${CENTER_COLOR} 0px, ${CENTER_COLOR} ${CENTER_RADIUS_PX}px, transparent ${CENTER_RADIUS_PX + CENTER_FADE_PX}px)`,
            ),
          }}
        />
      )}
      <span className="relative inline-flex items-end gap-2">
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

// Real projectile-under-gravity kinematics (constant acceleration),
// not springValue's damped-oscillator curve -- tried spring easing for
// this twice (once as the up/down shape of scripted hops, once as a
// single long decaying oscillation) and both looked like "pulled back
// on a rubber band and let go," never like gravity. The reason is
// structural, not a tuning miss: a spring released from a displaced
// position starts at *zero velocity* and *speeds up* toward the
// target -- exactly backwards from a thrown ball, which leaves the
// ground at *maximum* velocity and *decelerates* to a stop at the
// peak, then free-falls from rest at the top and hits the ground at
// maximum velocity. A rubber band's snap and a dropped ball's fall are
// different shapes, not just different speeds.
//
// progress is t/duration, clamped to [0,1]. Both are the same
// constant-acceleration parabola, y = -h*(1-(1-p)^2) for rise and
// y = -h*(1-p^2) for fall -- reversed in time from each other, which
// is exactly the real symmetry of a projectile's up-leg and down-leg
// under constant gravity (equal time, mirrored velocity profile).
function gravityRise(progress: number, heightPx: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return -heightPx * (1 - (1 - p) * (1 - p));
}
function gravityFall(progress: number, heightPx: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return -heightPx * (1 - p * p);
}

// Time for one full ground<->peak-height traversal -- the *same*
// duration serves both that height's rise and its fall, since real
// gravity takes exactly as long to rise to a given height as it does
// to fall back from it.
const DOT_HOP_S = 0.26;
// How much height survives each bounce, and how many bounces play
// before it's settled.
const DOT_RESTITUTION = 0.45;
const DOT_BOUNCE_COUNT = 3; // bounce-backs after the initial launch, each one smaller
const DOT_REST_S = 0.7;
const DOT_PEAK_HEIGHT_PX = 8.5; // how high the initial launch throws each dot above rest

type DotPhase = { kind: "rise" | "fall" | "rest"; heightPx: number; duration: number };

/**
 * One full dot cycle as an explicit list of hops: launch straight up
 * to the peak, then alternating falls (peak height -> 0) and smaller
 * bounce-backs (0 -> peak height * DOT_RESTITUTION, repeated), each
 * one's duration scaled by the physical sqrt(height ratio)
 * relationship (real gravity's time-to-fall/rise from height h is
 * proportional to sqrt(h)) so smaller bounces read as quicker, not
 * just shorter, hops -- then a final rest. Built once at module scope
 * since it's the same sequence for every Dot instance; the tick loop
 * below just walks it cyclically by duration and index instead of a
 * hand-written phase enum.
 */
function buildDotPhases(): DotPhase[] {
  let height = DOT_PEAK_HEIGHT_PX;
  let duration = DOT_HOP_S;
  const phases: DotPhase[] = [{ kind: "rise", heightPx: height, duration }];
  for (let i = 0; i <= DOT_BOUNCE_COUNT; i++) {
    phases.push({ kind: "fall", heightPx: height, duration });
    if (i === DOT_BOUNCE_COUNT) break;
    height *= DOT_RESTITUTION;
    duration = DOT_HOP_S * Math.sqrt(height / DOT_PEAK_HEIGHT_PX);
    phases.push({ kind: "rise", heightPx: height, duration });
  }
  phases.push({ kind: "rest", heightPx: 0, duration: DOT_REST_S });
  return phases;
}
const DOT_PHASES = buildDotPhases();

// Three dots bouncing in a staggered wave, each one only ever resting
// at the bottom between hops (never mid-air) -- launched upward, then
// brought back down and bounced by gravity, not a pendulum swinging
// symmetrically. Driven by gravityRise()/gravityFall() above inside a
// plain requestAnimationFrame loop -- the same technique (though not
// the same math -- see those functions' own comment for why springValue
// specifically was wrong for this) the 3D loading graph uses for its
// own animation, not react-spring. That's not just consistency for its
// own sake: react-spring produced two real bugs trying to do this
// exact thing, and this page is a uniquely hostile environment for
// exactly the kind of timing assumption both bugs made, since the 3D
// loading graph is *also* running concurrently, competing hard for the
// same main thread and stalling it in irregular bursts.
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
// items-end alone aligns the dot's bottom to the *line box's* bottom,
// not to any actual letter's -- and the line box extends well below
// the baseline to reserve room for descenders (the "g" in "Loading"),
// landing the dot flush with "g", not "L". Measured directly via
// canvas.measureText against this button's own font (JetBrains Mono,
// 500 16px/24px): fontBoundingBoxDescent is 5px, while "L" itself has
// an actualBoundingBoxDescent of 0 (its ink stops exactly at the
// baseline, having no descender) -- so items-end alone leaves the dot
// resting 5px below "L"'s true bottom. This pulls it back up by
// exactly that, landing it flush with "L" instead of "g".
const DOT_REST_OFFSET_PX = -5;

function LoadingDots() {
  return (
    <span className="inline-flex items-end gap-1" aria-hidden="true" style={{ transform: `translateY(${DOT_REST_OFFSET_PX}px)` }}>
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
    let phaseIndex = 0;
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
          const duration = DOT_PHASES[phaseIndex].duration;
          if (t <= duration) break;
          phaseStart += duration;
          t -= duration;
          phaseIndex = (phaseIndex + 1) % DOT_PHASES.length;
        }
        const phaseInfo = DOT_PHASES[phaseIndex];
        const progress = t / phaseInfo.duration;
        const y =
          phaseInfo.kind === "rise"
            ? gravityRise(progress, phaseInfo.heightPx)
            : phaseInfo.kind === "fall"
              ? gravityFall(progress, phaseInfo.heightPx)
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
