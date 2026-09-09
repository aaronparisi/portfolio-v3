/**
 * The nav's "logo": a hexagonal badge carrying an "AP" monogram, filled
 * with an on-brand cyan → lime → pink gradient and glowing the same way
 * the rest of the page's control-panel elements do. Replaces a plain
 * text wordmark with something that reads as a mark/emblem instead.
 */
export function BrandMark() {
  return (
    <a
      href="#top"
      aria-label="Aaron Parisi — back to top"
      className="brand-mark relative inline-flex h-9 w-9 shrink-0 items-center justify-center"
    >
      <span className="brand-hex absolute inset-0" aria-hidden="true" />
      <span className="brand-letters relative font-display text-xs font-bold">AP</span>
    </a>
  );
}
