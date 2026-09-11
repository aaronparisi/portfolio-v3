import { Reveal } from "./Reveal";

// Not attributed to a name/title here, since none was given — better to
// leave it generic than invent one. Swap in real names/roles whenever
// you'd like the fuller attribution.
const ENDORSEMENTS = [
  "He asks the right questions and consistently drives bugs to their root cause instead of shipping fragile fixes.",
  "What I appreciated most was the way he asks deeper questions, which brings clarity to problems. I saw many times where he would ask a probing question about something we all thought we understood, and in trying to answer it, we realized our assumptions were flawed.",
];

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

        <div className="mt-10 grid gap-5 text-left sm:grid-cols-2">
          {ENDORSEMENTS.map((quote, i) => (
            <Reveal key={i} delay={120 + i * 100}>
              <blockquote
                className="h-full rounded-2xl bg-[var(--bg-alt)] p-5 text-sm italic leading-relaxed text-[var(--ink-soft)]"
                style={{ borderLeft: `3px solid ${i % 2 === 0 ? "var(--accent)" : "var(--accent-warm)"}` }}
              >
                &ldquo;{quote}&rdquo;
                <footer className="mt-3 font-mono text-xs not-italic text-[var(--ink-soft)]">
                  — LinkedIn recommendation
                </footer>
              </blockquote>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
