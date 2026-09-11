import { animated, useSpring } from "@react-spring/web";
import { Reveal } from "./Reveal";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const ENDORSEMENTS = [
  {
    name: "Kyle",
    quote:
      "Aaron is a curious and quick-learning engineer with a strong instinct for quality. He asks the right questions and consistently drives bugs to their root cause instead of shipping fragile fixes. He raises the bar for the code around him.",
  },
  {
    name: "Peter",
    quote:
      "What I appreciated most was the way he asks deeper questions, which brings clarity to problems. I saw many times where he would ask a probing question about something we all thought we understood, and in trying to answer it, we realized our assumptions were flawed.",
  },
];

function EndorsementCard({ name, quote, accent }: { name: string; quote: string; accent: string }) {
  const reduced = usePrefersReducedMotion();
  const [style, api] = useSpring(() => ({ scale: 1, shadow: 0, config: { tension: 280, friction: 20 } }));

  return (
    <animated.blockquote
      onPointerEnter={() => !reduced && void api.start({ scale: 1.025, shadow: 1 })}
      onPointerLeave={() => void api.start({ scale: 1, shadow: 0 })}
      className="h-full rounded-2xl bg-[var(--bg-alt)] p-5 text-sm italic leading-relaxed text-[var(--ink-soft)]"
      style={{
        borderLeft: `3px solid ${accent}`,
        scale: style.scale,
        boxShadow: style.shadow.to(
          (s) => `0 ${s * 20}px ${s * 30}px -${s * 10}px rgb(0 0 0 / ${s * 0.25})`,
        ),
      }}
    >
      &ldquo;{quote}&rdquo;
      <footer className="mt-3 font-mono text-xs not-italic text-[var(--ink-soft)]">
        — {name}, via LinkedIn
      </footer>
    </animated.blockquote>
  );
}

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
            I taught AP Calculus before I ever wrote a line of code. Teaching advanced mathematics
            requires more than just being smart - you have to understand complexity well enough to explain it;
            you have to understand people well enough to connect with them.
            Turns out this translates well: I bring those same instincts to the frontend, seeking roles
            that involve extensive collaboration with product and design, and always digging one
            layer deeper into the architecture I build, and the tools I use to build it.
          </p>
          <p className="mx-auto mt-8 max-w-xl text-sm italic leading-relaxed text-[var(--ink-soft)]">
            I&rsquo;ll admit it: I don&rsquo;t have years and years of development experience.
            I&rsquo;ve never studied advanced algorithms. I&rsquo;m no mastermind, and I am not
            the fastest developer this side of the Mississippi.
          </p>
          <p className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-[var(--ink-soft)]">
            And&hellip; in the words of my coworkers, I am{" "}
            <span className="font-semibold text-[var(--ink)]">&ldquo;an asset to any team&rdquo;</span>.{" "}
            <span className="font-display text-xl italic text-[var(--accent-warm)]">Why?</span>
          </p>
          <p className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-[var(--ink-soft)]">
            Because I don&rsquo;t just find <em>&ldquo;a solution&rdquo;</em> ~ {" "}
            <strong className="font-semibold text-[var(--ink)]">
              I dig until I am confident my code is well-written.
            </strong>{" "}
            Because I don&rsquo;t just find bugs ~{" "}
            <strong className="font-semibold text-[var(--ink)]">
              I poke and prod until I know <span className="text-[var(--accent-warm)]">WHY</span>{" "}
              the code broke, and how to fix it at the root.
            </strong>{" "}
            I can&rsquo;t grok spaghetti code, so I don&rsquo;t write it. And I have a hawkish eye
            for inconsistencies ~ so when something doesn&rsquo;t make sense to me, I ask about it
            until I do.
          </p>
          <p className="mx-auto mt-8 max-w-xl text-sm italic leading-relaxed text-[var(--ink-soft)]">
            But don&rsquo;t take my word for it&hellip;
          </p>
        </Reveal>

        <div className="mt-10 grid gap-5 text-left sm:grid-cols-2">
          {ENDORSEMENTS.map((entry, i) => (
            <Reveal key={entry.name} delay={120 + i * 100}>
              <EndorsementCard
                name={entry.name}
                quote={entry.quote}
                accent={i % 2 === 0 ? "var(--accent)" : "var(--accent-warm)"}
              />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
