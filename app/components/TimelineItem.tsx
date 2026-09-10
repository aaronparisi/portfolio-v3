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

export function TimelineItem({ entry }: { entry: TimelineEntry }) {
  const Icon = ICONS[entry.icon];

  return (
    <li className="relative pl-16 sm:pl-20">
      <span
        data-current={entry.current ? "true" : undefined}
        className="timeline-dot absolute left-0 top-0.5 flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink-soft)]"
      >
        <Icon className="h-5 w-5" />
      </span>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-lg font-semibold text-[var(--ink)]">{entry.title}</h3>
        <span className="font-mono text-xs text-[var(--ink-soft)]">{entry.range}</span>
      </div>
      <p className="font-mono text-sm text-[var(--accent)]">{entry.org}</p>
      <ul className="mt-2 space-y-1.5">
        {entry.bullets.map((bullet, idx) => (
          <li key={idx} className="flex items-start gap-2.5 text-sm leading-relaxed text-[var(--ink-soft)]">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--ink-soft)]" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}
