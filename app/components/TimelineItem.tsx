import type { CSSProperties } from "react";
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

export function TimelineItem({ entry, t }: { entry: TimelineEntry; t: number }) {
  const Icon = ICONS[entry.icon];

  return (
    <li className="relative" style={{ "--t": t } as CSSProperties}>
      <span className="timeline-node absolute -left-8 top-0 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full text-[var(--base3)] shadow-md sm:-left-10">
        <Icon className="h-5 w-5" />
      </span>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-lg font-semibold text-[var(--text-strong)]">
          {entry.title}
          {entry.current && (
            <span className="ml-2 inline-block h-2 w-2 rounded-full bg-[var(--green)] align-middle" title="Current role" />
          )}
        </h3>
        <span className="font-mono text-xs text-[var(--text-muted)]">{entry.range}</span>
      </div>
      <p className="font-mono text-sm text-[var(--blue)]">{entry.org}</p>
      <ul className="mt-2 space-y-1.5">
        {entry.bullets.map((bullet, idx) => (
          <li key={idx} className="flex gap-2 text-sm text-[var(--text)]">
            <span className="mt-1 text-[var(--text-muted)]">–</span>
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}
