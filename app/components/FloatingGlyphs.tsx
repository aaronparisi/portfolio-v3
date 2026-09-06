import type { CSSProperties } from "react";

export interface Glyph {
  symbol: string;
  top: string;
  left: string;
  size: string;
  /** Parallax multiplier — higher drifts further per pixel scrolled. */
  speed: number;
  rotate?: string;
  font?: "chalk" | "mono";
}

/**
 * A layer of decorative symbols that drift at their own speed as the page
 * scrolls (driven by the `--scroll-y` custom property from
 * useScrollProgress), giving the background a sense of depth.
 */
export function FloatingGlyphs({
  glyphs,
  className = "",
}: {
  glyphs: Glyph[];
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {glyphs.map((g, i) => (
        <span
          key={i}
          className={`parallax absolute select-none opacity-30 ${
            g.font === "mono" ? "font-mono" : "font-chalk"
          }`}
          style={
            {
              top: g.top,
              left: g.left,
              fontSize: g.size,
              "--parallax-speed": g.speed,
              "--parallax-rotate": g.rotate ?? "0deg",
            } as CSSProperties
          }
        >
          {g.symbol}
        </span>
      ))}
    </div>
  );
}
