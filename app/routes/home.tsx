import { useState } from "react";
import type { Route } from "./+types/home";
import { Nav } from "~/components/Nav";
import { Hero } from "~/components/Hero";
import { About } from "~/components/About";
import { Timeline } from "~/components/Timeline";
import { Skills } from "~/components/Skills";
import { Footer } from "~/components/Footer";
import { ScrollProgress } from "~/components/ScrollProgress";
// Swapped from the bar-equalizer loader (still in LoadingScreen.tsx,
// untouched, in case that's worth returning to) to the 3D calculus-
// surface loader while that one's in development.
import { LoadingScreen3D as LoadingScreen } from "~/components/LoadingScreen3D";
import { useActiveSectionHash } from "~/hooks/useActiveSectionHash";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

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

  return (
    <div id="top" className="min-h-screen text-[var(--ink)]">
      <div className="grain" aria-hidden="true" />
      {showLoading ? (
        <LoadingScreen onComplete={() => setLoading(false)} />
      ) : (
        <>
          <ScrollProgress />
          <Nav />
          <main>
            <Hero />
            <About />
            <Timeline />
            <Skills />
          </main>
          <Footer />
        </>
      )}
    </div>
  );
}
