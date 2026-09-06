import { timeline } from "~/data/timeline";
import { TimelineItem } from "./TimelineItem";
import { PivotCard } from "./PivotCard";
import { Reveal } from "./Reveal";
import { FloatingGlyphs, type Glyph } from "./FloatingGlyphs";

// A denser, almost entirely code-flavored layer — by the time you're
// scrolling through the career timeline, the chalk dust has mostly settled.
const glyphs: Glyph[] = [
  { symbol: "npm run dev", top: "6%", left: "82%", size: "1rem", speed: 0.3, font: "mono" },
  { symbol: "git commit", top: "18%", left: "4%", size: "1.1rem", speed: 0.46, font: "mono" },
  { symbol: "async", top: "32%", left: "88%", size: "1.5rem", speed: 0.22, font: "mono" },
  { symbol: "0101", top: "46%", left: "6%", size: "1.75rem", speed: 0.5, font: "mono" },
  { symbol: "[ ]", top: "58%", left: "90%", size: "2.25rem", speed: 0.28, font: "mono" },
  { symbol: "&&", top: "70%", left: "5%", size: "2rem", speed: 0.4, font: "mono" },
  { symbol: "===", top: "82%", left: "85%", size: "1.5rem", speed: 0.34, font: "mono" },
  { symbol: "import", top: "92%", left: "8%", size: "1.1rem", speed: 0.2, font: "mono" },
  { symbol: "π", top: "3%", left: "50%", size: "1.5rem", speed: 0.24, font: "chalk" },
];

export function Timeline() {
  return (
    <section id="journey" className="relative overflow-hidden py-24 sm:py-32">
      <FloatingGlyphs glyphs={glyphs} className="text-[var(--cyan)]" />

      <div className="relative z-10 mx-auto max-w-3xl px-6">
        <Reveal>
          <p className="font-mono text-sm text-[var(--cyan)]">// the journey</p>
          <h2 className="mt-2 text-3xl font-bold text-[var(--text-strong)] sm:text-4xl">
            From Chalkboard to Codebase
          </h2>
        </Reveal>

        <ol className="relative mt-16 space-y-10 border-l-2 border-[var(--border)] pl-8 sm:pl-10">
          {timeline.map((entry, i) => {
            const t = timeline.length > 1 ? i / (timeline.length - 1) : 0;

            return (
              <Reveal key={entry.id} delay={Math.min(i, 4) * 60}>
                {entry.id === "appacademy" ? (
                  <PivotCard entry={entry} t={t} />
                ) : (
                  <TimelineItem entry={entry} t={t} />
                )}
              </Reveal>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
