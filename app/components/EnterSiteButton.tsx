import { useEffect, useRef, type PointerEvent } from "react";
import { animated, to, useSpring, useTrail } from "@react-spring/web";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

// The full Gruvbox bright palette, in hue order, so the conic gradient
// below reads as an actual rainbow wheel rather than a random jumble of
// theme colors.
const RAINBOW = ["#fb4934", "#fe8019", "#fabd2f", "#b8bb26", "#8ec07c", "#83a598", "#d3869b", "#fb4934"].join(", ");

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
 * hover/press feel as SpringButton, plus a Gruvbox rainbow conic
 * gradient that follows the cursor across it.
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
            background: to([glow.x, glow.y], (x, y) => `conic-gradient(from 0deg at ${x}% ${y}%, ${RAINBOW})`),
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

// Three dots bouncing in a staggered wave -- the same core mechanic as
// the bar-equalizer loader (a useTrail seeded with a static resting
// value, then kicked into an endless spring loop imperatively via a
// mount-effect's api.start(), never through the trail's own reactive
// per-render config). That distinction actually matters here, not just
// for consistency: a reactive `loop: {reverse: true}` recreated fresh
// on every render fights any later attempt to redirect it, which is
// exactly the bug that reactive form produced the first time it was
// tried for the auto-rotating 3D graph.
function LoadingDots() {
  const reduced = usePrefersReducedMotion();
  const [dots, dotsApi] = useTrail<{ y: number }>(3, () => ({ y: 0 }));

  useEffect(() => {
    if (reduced) return;
    void dotsApi.start((i) => ({
      to: async (next) => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await next({ y: -5, config: { tension: 300, friction: 10 } });
          await next({ y: 0, config: { tension: 300, friction: 14 } });
        }
      },
      delay: i * 130,
    }));
    return () => {
      dotsApi.stop();
    };
  }, [reduced, dotsApi]);

  return (
    <span className="inline-flex items-end gap-1" aria-hidden="true">
      {dots.map((style, i) => (
        <animated.span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full bg-current"
          style={{ transform: style.y.to((y) => `translate3d(0, ${y}px, 0)`) }}
        />
      ))}
    </span>
  );
}
