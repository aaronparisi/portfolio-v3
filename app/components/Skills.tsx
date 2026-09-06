import { Reveal } from "./Reveal";

const groups: { key: string; items: string[] }[] = [
  { key: "languages", items: ["TypeScript", "JavaScript", "SQL"] },
  { key: "frontend", items: ["React", "Recharts", "D3.js", "Plotly.js", "Tailwind CSS", "Material UI"] },
  { key: "tooling", items: ["Node.js", "Storybook", "Playwright", "OAuth2", "Vite"] },
];

export function Skills() {
  return (
    <section id="skills" className="relative mx-auto max-w-3xl px-6 py-24 sm:py-32">
      <Reveal>
        <p className="font-mono text-sm text-[var(--cyan)]">// skills</p>
        <h2 className="mt-2 text-3xl font-bold text-[var(--text-strong)] sm:text-4xl">
          What I Bring to the Table
        </h2>
      </Reveal>

      <Reveal delay={100}>
        <div className="mt-10 overflow-hidden rounded-xl border border-[var(--border)] shadow-sm">
          <div className="flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--bg-alt)] px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-[var(--red)]" />
            <span className="h-3 w-3 rounded-full bg-[var(--yellow)]" />
            <span className="h-3 w-3 rounded-full bg-[var(--green)]" />
            <span className="ml-3 font-mono text-xs text-[var(--text-muted)]">skills.ts</span>
          </div>
          <pre className="overflow-x-auto bg-[var(--bg)] px-5 py-6 font-mono text-sm leading-relaxed">
            <code>
              <span className="text-[var(--text-muted)]">
                {"// still asking \"why?\" — now about render cycles"}
              </span>
              {"\n"}
              <span className="text-[var(--green)]">const</span>{" "}
              <span className="text-[var(--blue)]">skills</span> = {"{"}
              {groups.map((g) => (
                <span key={g.key}>
                  {"\n  "}
                  <span className="text-[var(--blue)]">{g.key}</span>: [
                  {g.items.map((item, idx) => (
                    <span key={item}>
                      <span className="text-[var(--cyan)]">&quot;{item}&quot;</span>
                      {idx < g.items.length - 1 ? ", " : ""}
                    </span>
                  ))}
                  ],
                </span>
              ))}
              {"\n"}
              {"};"}
            </code>
          </pre>
        </div>
      </Reveal>
    </section>
  );
}
