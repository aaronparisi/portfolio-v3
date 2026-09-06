import { Reveal } from "./Reveal";

export function About() {
  return (
    <section id="about" className="relative mx-auto max-w-2xl px-6 py-24 text-center sm:py-32">
      <Reveal>
        <blockquote className="font-chalk text-3xl leading-snug text-[var(--text-strong)] sm:text-4xl">
          &ldquo;The kind of kid who kept asking, <span className="text-[var(--orange)]">why?</span>&rdquo;
        </blockquote>
        <p className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-[var(--text)]">
          I taught AP Calculus before I ever wrote a line of code — and it turns out curiosity
          translates well. These days I bring that same instinct to the frontend: seeking roles
          that involve extensive collaboration with product and design, and always digging one
          layer deeper into the tools and infrastructure behind them.
        </p>
      </Reveal>
    </section>
  );
}
