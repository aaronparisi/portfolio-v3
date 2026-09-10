import type { Route } from "./+types/home";
import { Nav } from "~/components/Nav";
import { Hero } from "~/components/Hero";
import { About } from "~/components/About";
import { Timeline } from "~/components/Timeline";
import { Skills } from "~/components/Skills";
import { Footer } from "~/components/Footer";
import { TwinkleStars } from "~/components/TwinkleStars";
import { useScrollProgress } from "~/hooks/useScrollProgress";
import { useActiveSectionHash } from "~/hooks/useActiveSectionHash";

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
  useScrollProgress();
  useActiveSectionHash();

  // No background of its own — this lets the page-length chalk-to-space
  // gradient on <body> (see app.css) show through every section that
  // doesn't paint an opaque background of its own (Nav and Footer do).
  // `relative` makes this div (which is exactly as tall as the whole
  // page) the containing block for TwinkleStars below.
  return (
    <div id="top" className="relative min-h-screen text-[var(--text)]">
      <TwinkleStars />
      <Nav />
      <main>
        <Hero />
        <About />
        <Timeline />
        <Skills />
      </main>
      <Footer />
    </div>
  );
}
