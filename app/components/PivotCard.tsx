import type { TimelineEntry } from "~/data/timeline";
import { TerminalIcon } from "./icons";

/** The App Academy entry gets special treatment — it's the hinge the whole story turns on. */
export function PivotCard({ entry }: { entry: TimelineEntry }) {
  return (
    <li className="relative pl-16 sm:pl-20">
      <span className="timeline-dot absolute left-0 top-0.5 flex h-11 w-11 items-center justify-center rounded-full text-[var(--accent-warm)]">
        <TerminalIcon className="h-5 w-5" />
      </span>

      <div className="pivot-card rounded-r-2xl bg-[var(--bg-alt)] p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="eyebrow text-[var(--accent-warm)]">The turning point</p>
          <span className="font-mono text-xs text-[var(--ink-soft)]">{entry.range}</span>
        </div>

        <h3 className="mt-2 text-xl font-semibold text-[var(--ink)]">{entry.title}</h3>
        <p className="font-mono text-sm text-[var(--accent)]">{entry.org}</p>

        <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
          At 1031 Services, transactions were tracked on a whiteboard and a stack of hand-written
          calendars. Functional, but barely. I taught myself enough Visual Basic to build a
          calendar application in Excel. I could see exactly what I needed to do for each transation,
          each day of the week - and it worked! Watching something I&rsquo;d built
          actually make my day easier was the hook: I quit the job and spent the next year at my
          kitchen table, studying full time, determined to make this my career.
        </p>

        <ul className="mt-4 space-y-1.5">
          {entry.bullets.map((bullet, idx) => (
            <li key={idx} className="flex items-start gap-2.5 text-sm leading-relaxed text-[var(--ink-soft)]">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--ink-soft)]" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
