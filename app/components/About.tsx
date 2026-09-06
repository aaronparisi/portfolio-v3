import { Reveal } from "./Reveal";
import { FloatingGlyphs, type Glyph } from "./FloatingGlyphs";
import { CoffeeIcon } from "./icons";

const glyphs: Glyph[] = [
  { symbol: "?", top: "12%", left: "86%", size: "3.5rem", speed: 0.34, font: "chalk", rotate: "-6deg" },
  { symbol: "∞", top: "85%", left: "80%", size: "2rem", speed: 0.22, font: "chalk", rotate: "5deg" },
  { symbol: "console.log", top: "80%", left: "5%", size: "1rem", speed: 0.26, font: "mono" },
  { symbol: "//", top: "8%", left: "7%", size: "2.5rem", speed: 0.2, font: "mono" },
  { icon: CoffeeIcon, top: "62%", left: "12%", size: "1.75rem", speed: 0.3, rotate: "-8deg", opacity: 0.22 },
  // Drifts right through the quote, kept very faint so it stays readable.
  { symbol: "{ why }", top: "40%", left: "48%", size: "1.25rem", speed: 0.44, font: "mono", opacity: 0.1 },
];

export function About() {
  return (
    <section id="about" className="relative overflow-hidden py-24 sm:py-32">
      <FloatingGlyphs glyphs={glyphs} className="text-[var(--text-muted)]" />

      <div className="relative z-10 mx-auto max-w-2xl px-6 text-center">
        <Reveal>
          <blockquote className="font-chalk text-3xl leading-snug text-[var(--text-strong)] sm:text-4xl">
            &ldquo;The kind of kid who kept asking, <span className="text-[var(--orange)]">why?</span>&rdquo;
          </blockquote>
          <p className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-[var(--text)]">
            I taught AP Calculus before I ever wrote a line of code; it turns out curiosity
            translates well. These days I bring that same instinct to the frontend: seeking roles
            that involve extensive collaboration with product and design, and always digging one
            layer deeper into the tools and infrastructure behind them.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
