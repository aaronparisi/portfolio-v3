import { animated, useSpring } from "@react-spring/web";
import type { TimelineEntry } from "~/data/timeline";
import { TerminalIcon } from "./icons";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

/**
 * The App Academy entry gets special treatment — it's the hinge the
 * whole story turns on. A fixed-width card for Timeline's own
 * horizontal room (HorizontalRoom.tsx), wider than the plain entries
 * around it.
 */
export function PivotCard({ entry }: { entry: TimelineEntry }) {
  const reduced = usePrefersReducedMotion();
  // Scale + a shadow that grows underneath it reads like the card
  // lifting off the surface in place, without actually moving position.
  const [style, api] = useSpring(() => ({
    scale: 1,
    shadow: 0,
    config: { tension: 280, friction: 20 },
  }));

  return (
    <animated.div
      onPointerEnter={() => !reduced && void api.start({ scale: 1.02, shadow: 1 })}
      onPointerLeave={() => void api.start({ scale: 1, shadow: 0 })}
      className="pivot-card flex w-[340px] shrink-0 flex-col rounded-2xl p-6 sm:w-[400px] sm:p-8"
      style={{
        scale: style.scale,
        boxShadow: style.shadow.to(
          (s) => `0 ${s * 20}px ${s * 30}px -${s * 10}px rgb(0 0 0 / ${s * 0.25})`,
        ),
      }}
    >
      <span className="timeline-dot flex h-11 w-11 items-center justify-center rounded-full text-[var(--accent-warm)]">
        <TerminalIcon className="h-5 w-5" />
      </span>

      {/* A grease-pencil margin note instead of an eyebrow label — the
          one card in the timeline someone circled. */}
      <p className="annotation mt-4 text-lg" style={{ color: "var(--accent-warm)" }}>
        the turning point
      </p>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-xl font-semibold text-[var(--ink)]">{entry.title}</h3>
        <span className="font-mono text-xs text-[var(--ink-soft)]">{entry.range}</span>
      </div>
      <p className="font-mono text-sm text-[var(--accent)]">{entry.org}</p>

      <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
        At 1031 Services, transactions were tracked on a whiteboard and a stack of hand-written
        calendars. Functional, but barely. I taught myself enough Visual Basic to build a
        calendar application in Excel. I could see exactly what I needed to do for each
        transaction, hour by hour, each day of the week - and it worked! Watching something
        I&rsquo;d built actually make my day easier was the hook: I quit the job and spent the
        next year at my kitchen table, studying full time, determined to make this my career.
      </p>

      <ul className="mt-4 space-y-1.5">
        {entry.bullets.map((bullet, idx) => (
          <li key={idx} className="flex items-start gap-2.5 text-sm leading-relaxed text-[var(--ink-soft)]">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--ink-soft)]" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </animated.div>
  );
}
