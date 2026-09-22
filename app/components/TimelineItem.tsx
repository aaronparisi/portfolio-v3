import type { TimelineEntry } from "~/data/timeline";
import {
  GraduationCapIcon,
  ChalkboardIcon,
  BriefcaseIcon,
  HeadsetIcon,
  LaptopIcon,
  ChartIcon,
  TerminalIcon,
} from "./icons";

const ICONS = {
  cap: GraduationCapIcon,
  chalkboard: ChalkboardIcon,
  briefcase: BriefcaseIcon,
  headset: HeadsetIcon,
  laptop: LaptopIcon,
  chart: ChartIcon,
  terminal: TerminalIcon,
};

/**
 * A fixed-width card for Timeline's own horizontal room (HorizontalRoom
 * .tsx) -- used to be a vertical-rail `<li>` with no background of its
 * own (the plain text read fine against a plain page background, but
 * not against the 3D backdrop now sitting behind everything); an
 * opaque card fixes both problems at once, horizontal layout and
 * legibility.
 */
export function TimelineItem({ entry }: { entry: TimelineEntry }) {
  const Icon = ICONS[entry.icon];

  return (
    <div className="flex w-[300px] shrink-0 flex-col rounded-2xl bg-[var(--bg-alt)] p-6 sm:w-[340px]">
      <span
        data-current={entry.current ? "true" : undefined}
        className="timeline-dot flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink-soft)]"
      >
        <Icon className="h-5 w-5" />
      </span>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-lg font-semibold text-[var(--ink)]">{entry.title}</h3>
        <span className="font-mono text-xs text-[var(--ink-soft)]">{entry.range}</span>
      </div>
      <p className="font-mono text-sm text-[var(--accent)]">{entry.org}</p>
      <ul className="mt-3 space-y-1.5">
        {entry.bullets.map((bullet, idx) => (
          <li key={idx} className="flex items-start gap-2.5 text-sm leading-relaxed text-[var(--ink-soft)]">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--ink-soft)]" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
