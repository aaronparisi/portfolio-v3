import { FloatingGlyphs, type Glyph } from "./FloatingGlyphs";
import { ChevronDownIcon } from "./icons";

const mathGlyphs: Glyph[] = [
  { symbol: "∫", top: "12%", left: "8%", size: "3rem", speed: 0.12, rotate: "-8deg" },
  { symbol: "Σ", top: "22%", left: "80%", size: "2.5rem", speed: 0.2, rotate: "6deg" },
  { symbol: "π", top: "68%", left: "12%", size: "2rem", speed: 0.08, rotate: "4deg" },
  { symbol: "Δ", top: "78%", left: "66%", size: "2.25rem", speed: 0.16, rotate: "-4deg" },
  { symbol: "√x", top: "40%", left: "4%", size: "1.75rem", speed: 0.1 },
  { symbol: "lim", top: "8%", left: "52%", size: "1.5rem", speed: 0.06 },
];

const codeGlyphs: Glyph[] = [
  { symbol: "</>", top: "18%", left: "68%", size: "2.25rem", speed: 0.22, font: "mono" },
  { symbol: "{ }", top: "60%", left: "84%", size: "2.5rem", speed: 0.14, font: "mono" },
  { symbol: "=>", top: "82%", left: "20%", size: "1.75rem", speed: 0.1, font: "mono" },
  { symbol: "const", top: "50%", left: "6%", size: "1.25rem", speed: 0.18, font: "mono" },
  { symbol: ";", top: "30%", left: "92%", size: "2.5rem", speed: 0.08, font: "mono" },
];

export function Hero() {
  return (
    <section className="relative flex min-h-[100svh] items-center justify-center overflow-hidden">
      <FloatingGlyphs glyphs={mathGlyphs} className="text-[var(--yellow)]" />
      <FloatingGlyphs glyphs={codeGlyphs} className="text-[var(--cyan)]" />

      <div className="relative z-10 mx-auto max-w-3xl px-6 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-[var(--text-strong)] sm:text-7xl">
          Aaron Parisi
        </h1>
        <p className="mt-6 flex flex-wrap items-center justify-center gap-3 text-2xl sm:text-3xl">
          <span className="font-chalk text-[var(--orange)]">Calculus Teacher</span>
          <span className="text-[var(--text-muted)]">→</span>
          <span className="font-mono text-[var(--cyan)]">Frontend Developer</span>
        </p>
        <p className="mx-auto mt-6 max-w-xl text-balance text-base leading-relaxed text-[var(--text)]">
          Self-taught web developer with expertise in SQL, React, TypeScript, Node.js, and
          Recharts. Hungry to deepen my knowledge of frontend tools and the infrastructure behind
          them — the kind of kid who kept asking, &ldquo;Why?&rdquo;
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a
            href="#journey"
            className="rounded-full bg-[var(--blue)] px-6 py-3 font-medium text-[var(--base3)] transition-transform hover:scale-105"
          >
            See My Journey
          </a>
          <a
            href="#contact"
            className="rounded-full border border-[var(--border)] px-6 py-3 font-medium text-[var(--text)] transition-colors hover:border-[var(--blue)] hover:text-[var(--blue)]"
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
