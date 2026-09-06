import { useEffect, useRef, type ComponentType, type CSSProperties } from "react";

export interface Glyph {
  /** Either a text symbol... */
  symbol?: string;
  /** ...or an icon component (rendered at 1em, so `size` controls both). */
  icon?: ComponentType<{ className?: string }>;
  top: string;
  left: string;
  size: string;
  /** Parallax multiplier — higher drifts further per pixel scrolled. */
  speed: number;
  rotate?: string;
  font?: "chalk" | "mono";
  /** 0-1. Defaults to 0.3 — drop this lower for glyphs meant to pass
   *  behind readable text so they stay legible-under. */
  opacity?: number;
}

/**
 * A layer of decorative symbols/icons that drift at their own speed as the
 * page scrolls, giving the background a sense of depth. Movement is
 * computed relative to each layer's own position in the document (via
 * `--layer-origin`) rather than raw page scroll — so the effect stays
 * equally dramatic whether the layer sits in the hero or two thousand
 * pixels further down the page.
 */
export function FloatingGlyphs({
  glyphs,
  className = "",
}: {
  glyphs: Glyph[];
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const origin = el.getBoundingClientRect().top + window.scrollY;
      el.style.setProperty("--layer-origin", String(origin));
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {glyphs.map((g, i) => {
        const Icon = g.icon;
        return (
          <span
            key={i}
            className={`parallax absolute select-none ${g.font === "mono" ? "font-mono" : "font-chalk"}`}
            style={
              {
                top: g.top,
                left: g.left,
                fontSize: g.size,
                opacity: g.opacity ?? 0.3,
                "--parallax-speed": g.speed,
                "--parallax-rotate": g.rotate ?? "0deg",
              } as CSSProperties
            }
          >
            {Icon ? <Icon className="block h-[1em] w-[1em]" /> : g.symbol}
          </span>
        );
      })}
    </div>
  );
}
