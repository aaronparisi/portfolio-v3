import { useCallback, useRef, useState } from "react";
import type { Route } from "./+types/home";
import { Nav } from "~/components/Nav";
import { Hero } from "~/components/Hero";
import { About } from "~/components/About";
import { Timeline } from "~/components/Timeline";
import { Skills } from "~/components/Skills";
import { Footer } from "~/components/Footer";
import { ScrollProgress } from "~/components/ScrollProgress";
import { Experience3D } from "~/components/Experience3D";
// Swapped from the bar-equalizer loader (still in LoadingScreen.tsx,
// untouched, in case that's worth returning to) to the 3D calculus-
// surface loader while that one's in development.
import { LoadingScreen3D as LoadingScreen } from "~/components/LoadingScreen3D";
import { useActiveSectionHash } from "~/hooks/useActiveSectionHash";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";
import { useStoryProgressRef } from "~/hooks/useStoryProgressRef";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Aaron Parisi; Frontend Developer" },
    {
      name: "description",
      content:
        "Calculus teacher turned self-taught frontend developer. React, TypeScript, and data visualization.",
    },
  ];
}

export default function Home() {
  useActiveSectionHash();
  const reduced = usePrefersReducedMotion();
  const [loading, setLoading] = useState(true);

  // There's nothing this is actually gating — it's a purely decorative
  // open for the site, so a visitor who has motion turned off should
  // never see it at all rather than get a static screen in its place.
  const showLoading = loading && !reduced;

  // The whole 3D backdrop's story-progress span is Hero through Skills
  // -- this ref bounds that measurement (see useStoryProgressRef's own
  // comment for why it's a ref, not state). Footer deliberately sits
  // outside it: the backdrop fades itself out approaching progress 1
  // (Experience3D's own FADE_START), so Footer reads as a clean stop.
  const experienceRef = useRef<HTMLDivElement>(null);
  const progressRef = useStoryProgressRef(experienceRef);

  const [booted, setBooted] = useState(false);
  // Bumped once per story beat (About/the timeline's pivot card/Skills
  // scrolling into view) -- Experience3D watches for the increment and
  // replays its own tile-blowout + Gruvbox color pulse in response. A
  // plain incrementing counter, not a boolean, so two beats close
  // together (e.g. a very fast scroll) still each register as a real
  // change instead of colliding on the same "true".
  const [pulseSignal, setPulseSignal] = useState(0);
  const bumpPulse = useCallback(() => setPulseSignal((n) => n + 1), []);

  return (
    <div id="top" className="min-h-screen text-[var(--ink)]">
      <div className="grain" aria-hidden="true" />
      {showLoading ? (
        <LoadingScreen onComplete={() => setLoading(false)} />
      ) : (
        <>
          <Experience3D progressRef={progressRef} pulseSignal={pulseSignal} onBootComplete={() => setBooted(true)} />
          <ScrollProgress />
          <Nav booted={booted} />
          <main>
            <div ref={experienceRef}>
              <Hero booted={booted} />
              <About onEnter={bumpPulse} />
              <Timeline onPivotEnter={bumpPulse} />
              <Skills onEnter={bumpPulse} />
            </div>
          </main>
          <Footer />
        </>
      )}
    </div>
  );
}
