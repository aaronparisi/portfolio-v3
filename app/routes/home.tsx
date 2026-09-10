import type { Route } from "./+types/home";
import { Nav } from "~/components/Nav";
import { Hero } from "~/components/Hero";
import { About } from "~/components/About";
import { Timeline } from "~/components/Timeline";
import { Skills } from "~/components/Skills";
import { Footer } from "~/components/Footer";
import { ScrollProgress } from "~/components/ScrollProgress";
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
  useActiveSectionHash();

  return (
    <div id="top" className="min-h-screen text-[var(--ink)]">
      <div className="grain" aria-hidden="true" />
      <ScrollProgress />
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
