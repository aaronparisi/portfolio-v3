import type { CSSProperties } from "react";
import type { TimelineEntry } from "~/data/timeline";
import { TerminalIcon } from "./icons";

/** The App Academy entry gets special treatment — it's the hinge the whole story turns on. */
export function PivotCard({ entry, t }: { entry: TimelineEntry; t: number }) {
  return (
    <li className="relative" style={{ "--t": t } as CSSProperties}>
      <span className="timeline-node absolute -left-8 top-0 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full text-[var(--base3)] shadow-md sm:-left-10">
        <TerminalIcon className="h-5 w-5" />
      </span>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-alt)] p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--orange)]">
            The turning point
          </p>
          <span className="font-mono text-xs text-[var(--text-muted)]">{entry.range}</span>
        </div>

        <h3 className="mt-2 text-xl font-semibold text-[var(--text-strong)]">
          {entry.title} — {entry.org}
        </h3>

        <p className="mt-3 text-sm leading-relaxed text-[var(--text)]">
          At 1031 Services, closings were tracked on a color-coded whiteboard and a stack of
          hand-written calendars — functional, but barely. I taught myself just enough Excel VBA
          to build the team a real calendar application instead, and it worked. Watching
          something I&rsquo;d built actually make people&rsquo;s day easier was the hook: not
          long after, I quit and spent the next year at my kitchen table, studying full time,
          determined to make this my career.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3 font-mono text-sm">
          <span className="rounded-md bg-[var(--yellow)]/10 px-3 py-1.5 text-[var(--yellow)] decoration-2 line-through">
            ∫ f(x) dx
          </span>
          <span className="text-[var(--text-muted)]">→</span>
          <span className="rounded-md bg-[var(--cyan)]/10 px-3 py-1.5 text-[var(--cyan)]">
            const solve = (x) =&gt; {"{ ... }"}
          </span>
        </div>

        <ul className="mt-4 space-y-1.5">
          {entry.bullets.map((bullet, idx) => (
            <li key={idx} className="flex items-start gap-2.5 text-sm text-[var(--text)]">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
