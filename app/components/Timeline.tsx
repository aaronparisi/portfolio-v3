import { timeline } from "~/data/timeline";
import { TimelineItem } from "./TimelineItem";
import { PivotCard } from "./PivotCard";
import { Reveal } from "./Reveal";
import { FloatingGlyphs, type Glyph } from "./FloatingGlyphs";
import { GitBranchIcon, DatabaseIcon, CloudIcon } from "./icons";

// Mostly code now, with math still turning up now and then — scattered
// across the full width (including straight through the middle, behind
// the timeline text, at low opacity) rather than lined up along the edges.
const glyphs: Glyph[] = [
  { symbol: "π", top: "4%", left: "46%", size: "1.5rem", speed: 0.24, font: "chalk", opacity: 0.18 },
  { symbol: "npm run dev", top: "9%", left: "78%", size: "1rem", speed: 0.3, font: "mono" },
  { symbol: "git commit", top: "16%", left: "8%", size: "1.1rem", speed: 0.46, font: "mono" },
  { icon: GitBranchIcon, top: "27%", left: "58%", size: "1.6rem", speed: 0.36, rotate: "8deg", opacity: 0.14 },
  { symbol: "async", top: "36%", left: "88%", size: "1.5rem", speed: 0.22, font: "mono" },
  { icon: DatabaseIcon, top: "48%", left: "13%", size: "1.9rem", speed: 0.3, opacity: 0.22 },
  { symbol: "0101", top: "56%", left: "84%", size: "1.6rem", speed: 0.5, font: "mono" },
  { icon: CloudIcon, top: "66%", left: "50%", size: "1.6rem", speed: 0.34, opacity: 0.1 },
  { symbol: "&&", top: "74%", left: "9%", size: "2rem", speed: 0.4, font: "mono" },
  { symbol: "===", top: "84%", left: "90%", size: "1.5rem", speed: 0.34, font: "mono" },
  { symbol: "import", top: "94%", left: "20%", size: "1.1rem", speed: 0.2, font: "mono" },
  { symbol: "Δ", top: "97%", left: "70%", size: "1.6rem", speed: 0.28, font: "chalk", rotate: "-5deg", opacity: 0.2 },
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
