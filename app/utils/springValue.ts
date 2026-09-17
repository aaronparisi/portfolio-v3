/**
 * The closed-form solution to a damped harmonic oscillator (mass 1,
 * starting at rest), evaluated directly from elapsed time rather than
 * numerically stepped like react-spring does. `tension`/`friction` mean
 * the same thing they do everywhere react-spring is used on this site.
 *
 * Reach for this (paired with your own requestAnimationFrame loop and a
 * plain elapsed-time/phase state machine) instead of react-spring
 * whenever several independently-timed instances of "the same" spring
 * need to run side by side without any risk of react-spring's own
 * internal state (or, for useTrail specifically, its built-in
 * inter-item "follow the next one" linking) coupling them together --
 * originally written for the 3D loading graph's own
 * requestAnimationFrame loop (which isn't React-driven at all, so a
 * second animation library there would only add indirection), and
 * later reused for the loading button's bouncing dots after react-spring
 * produced two real, hard-to-pin-down bugs trying to do the same thing:
 * useTrail's inter-item linking recursed into a genuine stack overflow,
 * and even after switching to fully independent per-item components with
 * useSpring, two of the three dots animated in perfect lockstep despite
 * different stagger delays (confirmed at the source level -- timestamped
 * logging showed both firing their transitions at the identical
 * millisecond -- and confirmed the two SpringValue objects genuinely
 * weren't the same reference). Whatever the precise cause inside
 * react-spring, evaluating this pure function directly from elapsed time
 * inside each instance's own loop has no shared mutable state for
 * anything to alias.
 */
export function springValue(t: number, from: number, to: number, tension: number, friction: number): number {
  if (t <= 0) return from;
  const omega0 = Math.sqrt(tension);
  const zeta = friction / (2 * Math.sqrt(tension));
  const delta = to - from;
  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const envelope = Math.exp(-zeta * omega0 * t);
    return to - delta * envelope * (Math.cos(omegaD * t) + ((zeta * omega0) / omegaD) * Math.sin(omegaD * t));
  }
  const envelope = Math.exp(-omega0 * t);
  return to - delta * envelope * (1 + omega0 * t);
}
