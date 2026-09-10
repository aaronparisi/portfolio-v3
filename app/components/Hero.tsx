import { AnimatedEquation } from "./AnimatedEquation";
import { FloatingGlyphs, type Glyph } from "./FloatingGlyphs";
import { ChevronDownIcon, TerminalIcon, LaptopIcon } from "./icons";

const mathGlyphs: Glyph[] = [
  { symbol: "∫", top: "12%", left: "8%", size: "3rem", speed: 0.3, rotate: "-8deg" },
  { symbol: "Σ", top: "22%", left: "80%", size: "2.5rem", speed: 0.48, rotate: "6deg" },
  { symbol: "π", top: "68%", left: "14%", size: "2rem", speed: 0.2, rotate: "4deg" },
  { symbol: "Δ", top: "78%", left: "66%", size: "2.25rem", speed: 0.4, rotate: "-4deg" },
  { symbol: "√x", top: "38%", left: "5%", size: "1.75rem", speed: 0.26 },
  { symbol: "lim", top: "8%", left: "54%", size: "1.5rem", speed: 0.16 },
  // Drifts directly behind the headline — kept faint so the text stays crisp.
  { symbol: "∞", top: "50%", left: "40%", size: "2rem", speed: 0.34, opacity: 0.12 },
];

const codeGlyphs: Glyph[] = [
  { symbol: "</>", top: "18%", left: "70%", size: "2.25rem", speed: 0.52, font: "mono" },
  { symbol: "{ }", top: "62%", left: "86%", size: "2.5rem", speed: 0.32, font: "mono" },
  { symbol: "=>", top: "84%", left: "22%", size: "1.75rem", speed: 0.24, font: "mono" },
  { symbol: "const", top: "50%", left: "8%", size: "1.25rem", speed: 0.42, font: "mono" },
  { symbol: ";", top: "28%", left: "92%", size: "2.5rem", speed: 0.18, font: "mono" },
  { icon: TerminalIcon, top: "46%", left: "60%", size: "1.75rem", speed: 0.3, opacity: 0.12 },
  { icon: LaptopIcon, top: "89%", left: "48%", size: "2rem", speed: 0.22, opacity: 0.22 },
];

// A third, purely cosmic layer — small marks with no math/code meaning of
// their own, drifting in the lime/pink/violet accents so the hero reads a
// little more like a viewport than a whiteboard. Split across three
// single-color layers since each FloatingGlyphs layer takes one color.
const spaceGlyphsLime: Glyph[] = [
  { symbol: "✦", top: "15%", left: "40%", size: "1rem", speed: 0.6, opacity: 0.35 },
  { symbol: "✦", top: "90%", left: "60%", size: "0.7rem", speed: 0.5, opacity: 0.3 },
];
const spaceGlyphsPink: Glyph[] = [
  { symbol: "✧", top: "72%", left: "88%", size: "0.8rem", speed: 0.45, opacity: 0.3 },
  { symbol: "✧", top: "6%", left: "88%", size: "0.9rem", speed: 0.38, opacity: 0.35 },
];
const spaceGlyphsViolet: Glyph[] = [
  { symbol: "○", top: "30%", left: "20%", size: "0.6rem", speed: 0.7, opacity: 0.4 },
];

export function Hero() {
  return (
    <section className="relative flex min-h-[100svh] items-center justify-center overflow-hidden">
      <FloatingGlyphs glyphs={mathGlyphs} className="text-[var(--yellow)]" />
      <FloatingGlyphs glyphs={codeGlyphs} className="text-[var(--cyan)]" />
      <FloatingGlyphs glyphs={spaceGlyphsLime} className="text-[var(--lime)]" />
      <FloatingGlyphs glyphs={spaceGlyphsPink} className="text-[var(--pink)]" />
      <FloatingGlyphs glyphs={spaceGlyphsViolet} className="text-[var(--violet)]" />

      <div className="relative z-10 mx-auto max-w-3xl px-6 text-center">
        <h1 className="text-glow font-display text-4xl tracking-wide text-[var(--text-strong)] sm:text-6xl">
          Aaron Parisi
        </h1>
        <AnimatedEquation />
        <p className="mx-auto mt-6 max-w-xl text-balance text-base leading-relaxed text-[var(--text)]">
          Calculus teacher turned self-taught web developer with expertise in SQL, React,
          TypeScript, Node.js, and Recharts. Hungry to deepen my knowledge of frontend tools and
          the infrastructure behind them.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a
            href="#journey"
            className="spaceship-glow rounded-full bg-[var(--accent-cta)] px-6 py-3 font-medium text-[var(--base3)]"
          >
            See My Journey
          </a>
          <a
            href="#contact"
            className="rounded-full border border-[var(--border)] px-6 py-3 font-medium text-[var(--text)] transition-colors hover:border-[var(--violet)] hover:text-[var(--violet)]"
          >
            Get In Touch
          </a>
        </div>
      </div>

      <a
        href="#about"
        aria-label="Scroll down"
        className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce text-[var(--text-muted)]"
      >
        <ChevronDownIcon className="h-6 w-6" />
      </a>
    </section>
  );
}
