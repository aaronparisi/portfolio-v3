import { timeline } from "~/data/timeline";
import { TimelineItem } from "./TimelineItem";
import { PivotCard } from "./PivotCard";
import { Reveal } from "./Reveal";

export function Timeline() {
  return (
    <section id="journey" className="relative mx-auto max-w-3xl px-6 py-24 sm:py-32">
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
    </section>
  );
}
