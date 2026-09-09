import type { CSSProperties } from "react";

interface TwinkleStar {
  top: string;
  left: string;
  size: string;
  color: string;
  delay: string;
  duration: string;
}

// A sprinkle of brighter stars layered over the ambient starfield (see
// --stars in app.css) — roughly a tenth as many, each pulsing in
// brightness on its own schedule rather than in lockstep. Positions are
// fixed rather than randomized so server and client render identically
// (this is rendered inside an SSR'd page); delays/durations are varied
// by hand instead for the same non-synced-sparkle effect.
const TWINKLE_STARS: TwinkleStar[] = [
  { top: "38%", left: "12%", size: "3px", color: "var(--lime)", delay: "0s", duration: "3.2s" },
  { top: "44%", left: "72%", size: "2.5px", color: "var(--pink)", delay: "1.1s", duration: "2.6s" },
  { top: "52%", left: "40%", size: "3px", color: "var(--cyan)", delay: "0.4s", duration: "3.6s" },
  { top: "58%", left: "88%", size: "2.5px", color: "var(--pink)", delay: "2s", duration: "3s" },
  { top: "64%", left: "20%", size: "3px", color: "var(--lime)", delay: "0.8s", duration: "2.8s" },
  { top: "70%", left: "60%", size: "2.5px", color: "var(--cyan)", delay: "1.6s", duration: "3.4s" },
  { top: "76%", left: "8%", size: "3px", color: "var(--pink)", delay: "0.2s", duration: "3s" },
  { top: "82%", left: "48%", size: "2.5px", color: "var(--lime)", delay: "2.4s", duration: "2.6s" },
  { top: "88%", left: "78%", size: "3px", color: "var(--cyan)", delay: "1.3s", duration: "3.8s" },
  { top: "93%", left: "30%", size: "2.5px", color: "var(--pink)", delay: "0.6s", duration: "3.2s" },
  { top: "97%", left: "65%", size: "3px", color: "var(--lime)", delay: "1.9s", duration: "2.9s" },
];

export function TwinkleStars() {
  return (
    <div aria-hidden="true" className="twinkle-stars pointer-events-none absolute inset-0 overflow-hidden">
      {TWINKLE_STARS.map((s, i) => (
        <span
          key={i}
          className="twinkle-star absolute rounded-full"
          style={
            {
              top: s.top,
              left: s.left,
              width: s.size,
              height: s.size,
              background: s.color,
              boxShadow: `0 0 6px ${s.color}`,
              animationDelay: s.delay,
              animationDuration: s.duration,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
