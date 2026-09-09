/**
 * The nav's "logo": an "AP" monogram inside a hexagonal outline, glowing
 * in the site's cyan → lime → pink gradient — an SVG rather than a
 * filled CSS shape specifically so the interior stays transparent (the
 * nav's own translucent, blurred background shows through inside it,
 * same as everywhere else in the hex).
 */
export function BrandMark() {
  return (
    <a
      href="#top"
      aria-label="Aaron Parisi — back to top"
      className="brand-mark relative inline-flex h-9 w-9 shrink-0 items-center justify-center"
    >
      <svg viewBox="0 0 36 36" className="brand-hex absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id="brand-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--cyan)" />
            <stop offset="50%" stopColor="var(--lime)" />
            <stop offset="100%" stopColor="var(--pink)" />
          </linearGradient>
        </defs>
        <polygon
          points="11,5 25,5 32,18 25,31 11,31 4,18"
          fill="none"
          stroke="url(#brand-gradient)"
          strokeWidth="2"
        />
      </svg>
      <span className="brand-letters relative font-display text-xs font-bold">AP</span>
    </a>
  );
}
