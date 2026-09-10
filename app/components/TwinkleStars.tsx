import type { CSSProperties } from "react";

interface TwinkleStar {
  top: string;
  left: string;
  size: string;
  color: string;
  delay: string;
  duration: string;
  variant: string;
}

// Deterministic PRNG (mulberry32), not Math.random() — this page is
// server-rendered, so whatever lays these stars out has to produce the
// exact same sequence on the server and in the client bundle, or React
// throws a hydration mismatch the moment it diffs the two trees. A fixed
// seed makes the "random" scatter below perfectly reproducible.
function mulberry32(seed: number) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Theme-aware: dark mode gets the raw, bright accents (high-contrast on
// a near-black sky); light mode gets the darkened -text variants (see
// app.css) plus plain cyan, since a pale sky needs dark, saturated
// specks rather than bright-on-black ones to actually show up.
const COLORS = ["var(--star-lime)", "var(--star-pink)", "var(--star-cyan)"];
// Three different irregular flicker curves (see app.css) — cycling
// through them, rather than everything sharing one animation, is most of
// what keeps a whole field of these from reading as one synchronized
// blinking panel.
const VARIANTS = ["", "variant-b", "variant-c"];

// A sprinkle of stars layered over the ambient starfield (see --stars in
// app.css), stable and noticeably brighter than the ambient dust, each
// flaring even brighter for about half a second every so often, on its
// own schedule. Generated rather than hand-typed so there can be enough
// of them to actually read as "a good portion of the stars" per screen —
// but from a fixed seed, so the layout is identical on every render
// rather than reshuffling.
function makeTwinkleStars(count: number): TwinkleStar[] {
  const random = mulberry32(0x50a2e5);
  const stars: TwinkleStar[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      top: `${(34 + random() * 64).toFixed(1)}%`,
      left: `${(2 + random() * 95).toFixed(1)}%`,
      size: `${(1.8 + random() * 1.8).toFixed(1)}px`,
      color: COLORS[Math.floor(random() * COLORS.length)],
      delay: `${(random() * 5).toFixed(2)}s`,
      // The flare itself is a fixed ~10-12% slice of each keyframe (see
      // app.css) — keeping the overall cycle in this range is what keeps
      // that slice reading as "about half a second" rather than a full
      // second at the long end.
      duration: `${(3 + random() * 3).toFixed(2)}s`,
      variant: VARIANTS[Math.floor(random() * VARIANTS.length)],
    });
  }
  return stars;
}

// Enough that a real, noticeable fraction of what's on screen at once is
// mid-flicker, rather than one or two you have to go looking for.
const TWINKLE_STARS = makeTwinkleStars(100);

export function TwinkleStars() {
  return (
    <div aria-hidden="true" className="twinkle-stars pointer-events-none absolute inset-0 overflow-hidden">
      {TWINKLE_STARS.map((s, i) => (
        <span
          key={i}
          className={`twinkle-star absolute rounded-full ${s.variant}`}
          style={
            {
              top: s.top,
              left: s.left,
              width: s.size,
              height: s.size,
              background: s.color,
              // --flare-blur is animated in app.css's twinkle-a/b/c
              // keyframes (registered via @property so it actually
              // interpolates) — referencing it here means the glow itself
              // blooms during a flare, not just the dot's opacity.
              boxShadow: `0 0 var(--flare-blur, 4px) ${s.color}`,
              animationDelay: s.delay,
              animationDuration: s.duration,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
