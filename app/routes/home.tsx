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

  return (
    <div id="top" className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
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
