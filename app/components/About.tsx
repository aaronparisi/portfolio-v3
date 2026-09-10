import { Reveal } from "./Reveal";

export function About() {
  return (
    <section id="about" className="py-24 sm:py-32">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <Reveal>
          <p className="eyebrow mb-6">About</p>
          <blockquote className="font-display text-3xl italic leading-snug text-[var(--ink)] sm:text-4xl">
            &ldquo;The kind of kid who kept asking,{" "}
            <span className="text-[var(--accent-warm)]">why?</span>&rdquo;
          </blockquote>
          <p className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-[var(--ink-soft)]">
            I taught AP Calculus before I ever wrote a line of code; it turns out curiosity
            translates well. These days I bring that same instinct to the frontend: seeking roles
            that involve extensive collaboration with product and design, and always digging one
            layer deeper into the tools and infrastructure behind them.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
