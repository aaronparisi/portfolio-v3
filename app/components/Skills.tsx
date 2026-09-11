import { useEffect, useRef, useState, type ComponentType, type MouseEvent } from "react";
import { animated, to, useSprings, useTrail } from "@react-spring/web";
import { Reveal } from "./Reveal";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";
import {
  CodeIcon,
  DatabaseIcon,
  AtomIcon,
  ChartIcon,
  PaletteIcon,
  HexagonIcon,
  BookIcon,
  FlaskIcon,
  LockIcon,
  BoltIcon,
} from "./icons";

interface SkillItem {
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const groups: { key: string; label: string; items: SkillItem[] }[] = [
  {
    key: "languages",
    label: "Languages",
    items: [
      { label: "TypeScript", icon: CodeIcon },
      { label: "JavaScript", icon: CodeIcon },
      { label: "SQL", icon: DatabaseIcon },
    ],
  },
  {
    key: "frontend",
    label: "Frontend",
    items: [
      { label: "React", icon: AtomIcon },
      { label: "Recharts", icon: ChartIcon },
      { label: "D3.js", icon: ChartIcon },
      { label: "Plotly.js", icon: ChartIcon },
      { label: "Tailwind CSS", icon: PaletteIcon },
      { label: "Material UI", icon: PaletteIcon },
    ],
  },
  {
    key: "tooling",
    label: "Tooling",
    items: [
      { label: "Node.js", icon: HexagonIcon },
      { label: "Storybook", icon: BookIcon },
      { label: "Playwright", icon: FlaskIcon },
      { label: "OAuth2", icon: LockIcon },
      { label: "Vite", icon: BoltIcon },
    ],
  },
];

// How far (in px) a pill's pull reaches, and how far (in px) it can
// actually travel toward the cursor at the very center of that radius.
// Strength and the hover scale bump below are both toned down ~40% from
// the first pass, which read as a bit much.
const MAGNET_RADIUS = 70;
const MAGNET_STRENGTH = 2.5;
const HOVER_SCALE = 1.09;

function PillGroup({ label, items, startIndex }: { label: string; items: SkillItem[]; startIndex: number }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const [visible, setVisible] = useState(false);
  const reduced = usePrefersReducedMotion();

  // The magnet's resting transform (x: 0, y: 0, scale: 1) is a visual
  // no-op — identical to rendering no inline transform at all — so it's
  // safe to withhold entirely until after mount rather than rendering a
  // combined-spring string during SSR (see PhotoCard/BrandMark for why
  // that specific combination is a real hydration mismatch, not just a
  // lint nit). The entrance trail below doesn't get this treatment,
  // since ITS resting state is deliberately hidden, not a no-op.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const el = sectionRef.current;
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

  const [magnet, magnetApi] = useSprings(items.length, () => ({
    x: 0,
    y: 0,
    scale: 1,
    config: { tension: 300, friction: 20 },
  }));

  function handleMouseMove(e: MouseEvent) {
    if (reduced) return;
    magnetApi.start((i) => {
      const el = itemRefs.current[i];
      if (!el) return {};
      // Measured from the outer wrapper, not the pill that actually
      // moves — a transform never changes an element's own layout box,
      // but re-measuring the *moving* element here would mean each
      // frame's rect reflects the previous frame's displacement,
      // compounding drift instead of settling.
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      const pull = Math.max(0, 1 - dist / MAGNET_RADIUS);
      const hovered =
        e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      return {
        x: dist > 0 ? (dx / dist) * pull * MAGNET_STRENGTH : 0,
        y: dist > 0 ? (dy / dist) * pull * MAGNET_STRENGTH : 0,
        scale: hovered ? HOVER_SCALE : 1,
      };
    });
  }

  function handleMouseLeave() {
    void magnetApi.start(() => ({ x: 0, y: 0, scale: 1 }));
  }

  return (
    <div ref={sectionRef} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      <p className="font-mono text-xs uppercase tracking-wide text-[var(--ink-soft)]">{label}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {trail.map((style, i) => {
          const Icon = items[i].icon;
          const iconColor = i % 2 === 0 ? "text-[var(--accent)]" : "text-[var(--accent-warm)]";
          return (
            // Outer: entrance only (fade + rise as it scrolls into
            // view). Never moves once settled, which is exactly why the
            // magnet's own distance calculation measures *this* element
            // rather than the pill below.
            <animated.span
              key={items[i].label}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              style={{
                opacity: style.opacity,
                transform: style.y.to((y) => `translate3d(0, ${y}px, 0)`),
                scale: style.scale,
              }}
            >
              {/* Middle: the actual pill — background, border, and the
                  magnet transform all live here, so the whole button
                  (not just its label) is what moves toward the cursor.
                  Resting at (0, 0, scale 1) is a visual no-op, so —
                  same reasoning as PhotoCard/BrandMark — it's withheld
                  until after mount rather than rendered through SSR. */}
              <animated.span
                className="pill inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm"
                style={
                  mounted
                    ? {
                        transform: to(
                          [magnet[i].x, magnet[i].y, magnet[i].scale],
                          (x, y, s) => `translate3d(${x}px, ${y}px, 0) scale(${s})`,
                        ),
                      }
                    : undefined
                }
              >
                {/* Inner: icon + label, no transform of their own — they
                    ride along rigidly with the pill instead of sliding
                    around independently inside it. */}
                <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
                {items[i].label}
              </animated.span>
            </animated.span>
          );
        })}
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
