import { timeline } from "~/data/timeline";
import { TimelineItem } from "./TimelineItem";
import { PivotCard } from "./PivotCard";
import { Reveal } from "./Reveal";

export function Timeline() {
  return (
    <section id="journey" className="py-24 sm:py-32">
      <div className="mx-auto max-w-3xl px-6">
        <Reveal>
          <p className="eyebrow">The journey</p>
          <h2 className="mt-2 font-display text-3xl text-[var(--ink)] sm:text-4xl">
            From chalkboard to codebase
          </h2>
        </Reveal>

        <ol className="relative mt-16 space-y-10">
          <span
            aria-hidden="true"
            className="timeline-rail absolute left-5 top-1 h-[calc(100%-2rem)] w-px sm:left-7"
          />
          {timeline.map((entry, i) => (
            <Reveal key={entry.id} delay={Math.min(i, 4) * 70}>
              {entry.id === "appacademy" ? (
                <PivotCard entry={entry} />
              ) : (
                <TimelineItem entry={entry} />
              )}
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
