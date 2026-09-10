import { useEffect, useRef, useState } from "react";
import { animated, useTrail } from "@react-spring/web";
import { Reveal } from "./Reveal";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const groups: { key: string; label: string; items: string[] }[] = [
  { key: "languages", label: "Languages", items: ["TypeScript", "JavaScript", "SQL"] },
  {
    key: "frontend",
    label: "Frontend",
    items: ["React", "Recharts", "D3.js", "Plotly.js", "Tailwind CSS", "Material UI"],
  },
  { key: "tooling", label: "Tooling", items: ["Node.js", "Storybook", "Playwright", "OAuth2", "Vite"] },
];

function PillGroup({ label, items, startIndex }: { label: string; items: string[]; startIndex: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const trail = useTrail(items.length, {
    from: { opacity: 0, y: 10, scale: 0.9 },
    to: { opacity: visible ? 1 : 0, y: visible ? 0 : 10, scale: visible ? 1 : 0.9 },
    delay: startIndex * 40,
    immediate: reduced,
    config: { tension: 260, friction: 20 },
  });

  return (
    <div ref={ref}>
      <p className="font-mono text-xs uppercase tracking-wide text-[var(--ink-soft)]">{label}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {trail.map((style, i) => (
          <animated.span
            key={items[i]}
            style={{
              opacity: style.opacity,
              transform: style.y.to((y) => `translate3d(0, ${y}px, 0)`),
              scale: style.scale,
            }}
            className="pill rounded-full px-4 py-1.5 text-sm"
          >
            {items[i]}
          </animated.span>
        ))}
      </div>
    </div>
  );
}

export function Skills() {
  let runningIndex = 0;

  return (
    <section id="skills" className="py-24 sm:py-32">
      <div className="mx-auto max-w-3xl px-6">
        <Reveal>
          <p className="eyebrow">Skills</p>
          <h2 className="mt-2 font-display text-3xl text-[var(--ink)] sm:text-4xl">
            What I bring to the table
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-8 sm:grid-cols-3">
          {groups.map((g) => {
            const start = runningIndex;
            runningIndex += g.items.length;
            return <PillGroup key={g.key} label={g.label} items={g.items} startIndex={start} />;
          })}
        </div>
      </div>
    </section>
  );
}
