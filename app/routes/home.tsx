import type { Route } from "./+types/home";
import { Nav } from "~/components/Nav";
import { Hero } from "~/components/Hero";
import { About } from "~/components/About";
import { Timeline } from "~/components/Timeline";
import { Skills } from "~/components/Skills";
import { Footer } from "~/components/Footer";
import { useScrollProgress } from "~/hooks/useScrollProgress";

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

  // No background of its own — this lets the page-length chalk-to-space
  // gradient on <body> (see app.css) show through every section that
  // doesn't paint an opaque background of its own (Nav and Footer do).
  return (
    <div id="top" className="min-h-screen text-[var(--text)]">
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
