import { timeline } from "~/data/timeline";
import { TimelineItem } from "./TimelineItem";
import { PivotCard } from "./PivotCard";
import { HorizontalRoom } from "./HorizontalRoom";
import { Reveal } from "./Reveal";

export function Timeline() {
  return (
    <section className="relative py-24 sm:py-32">
      {/* Same technique as About's #about anchor: keep the section's own
          top padding for natural-scroll rhythm, but land a nav click (or
          scroll-linked hash change) at the same distance from the
          viewport top that "About" uses — the anchor sits at the
          padding's inner edge, with scroll-margin-top set to the nav's
          height plus the same headroom About keeps below itself. */}
      <span id="journey" aria-hidden="true" className="absolute left-0 top-24 scroll-mt-[97px] sm:top-32" />
      <div className="mx-auto max-w-3xl px-6">
        <Reveal>
          {/* No backdrop-blur here -- see Hero.tsx's own comment on why
              it renders as a distorted ghost over the live WebGL canvas
              rather than clean glass. */}
          <h2 className="inline-block rounded-2xl bg-[var(--bg)]/92 px-4 py-2 font-display text-3xl text-[var(--ink)] sm:text-4xl">
            From chalkboard to codebase
          </h2>
        </Reveal>
      </div>

      {/* The site's first "room": scroll down through this span and the
          career entries below pan horizontally instead of scrolling
          away vertically -- a real "wait, we're moving sideways" beat
          rather than one continuous trip down the page. See
          HorizontalRoom's own comment. */}
      <div className="mt-12">
        <HorizontalRoom roomHeightVh={280}>
          {/* Leading/trailing spacers so the first and last cards don't
              start flush against the viewport edge mid-pan. */}
          <div aria-hidden="true" className="w-[6vw] shrink-0" />
          {timeline.map((entry) =>
            entry.id === "appacademy" ? (
              <PivotCard key={entry.id} entry={entry} />
            ) : (
              <TimelineItem key={entry.id} entry={entry} />
            ),
          )}
          <div aria-hidden="true" className="w-[6vw] shrink-0" />
        </HorizontalRoom>
      </div>
    </section>
  );
}
