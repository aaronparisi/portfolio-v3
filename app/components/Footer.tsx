import type { CSSProperties } from "react";
import { PinIcon, MailIcon, PhoneIcon, ArrowUpRightIcon, GitBranchIcon } from "./icons";
import { FloatingGlyphs, type Glyph } from "./FloatingGlyphs";

const glyphs: Glyph[] = [
  { symbol: "</>", top: "18%", left: "9%", size: "1.75rem", speed: 0.24, font: "mono" },
  { symbol: "git push", top: "78%", left: "86%", size: "1rem", speed: 0.36, font: "mono" },
  // One last equation, quietly, behind the sign-off.
  { symbol: "π", top: "48%", left: "44%", size: "1.5rem", speed: 0.16, font: "chalk", opacity: 0.1 },
  { icon: GitBranchIcon, top: "82%", left: "16%", size: "1.5rem", speed: 0.3, opacity: 0.18 },
];

// Purely decorative dashboard hardware for the footer's "control panel"
// strip — colors and (for the knobs) angles are set per-instance so the
// row doesn't look like it was stamped out once and repeated.
const dashItems: { type: "knob" | "switch" | "led"; color: string; angle?: string }[] = [
  { type: "knob", color: "var(--cyan)", angle: "-25deg" },
  { type: "switch", color: "var(--lime)" },
  { type: "led", color: "var(--pink)" },
  { type: "switch", color: "var(--cyan)" },
  { type: "knob", color: "var(--pink)", angle: "35deg" },
  { type: "led", color: "var(--lime)" },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer id="contact" className="dashboard-panel relative overflow-hidden px-6 py-20">
      <FloatingGlyphs glyphs={glyphs} className="text-[var(--text-muted)]" />

      <div className="relative z-10 mx-auto max-w-2xl text-center">
        <p className="font-mono text-sm text-[var(--cyan)]">// contact</p>
        <h2 className="mt-2 text-3xl font-bold text-[var(--base2)] sm:text-4xl">
          Let&rsquo;s Build Something
        </h2>
        <p className="mx-auto mt-4 max-w-md text-[var(--base1)]">
          Open to frontend roles with room to grow alongside product and design.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 font-mono text-sm">
          <span className="flex items-center gap-2 text-[var(--base1)]">
            <PinIcon className="h-4 w-4 text-[var(--text-muted)]" /> Seattle, WA
          </span>
          <a
            href="mailto:parisi.aaron@gmail.com"
            className="flex items-center gap-2 text-[var(--base1)] transition-colors hover:text-[var(--violet)]"
          >
            <MailIcon className="h-4 w-4 text-[var(--text-muted)]" /> parisi.aaron@gmail.com
          </a>
          <a
            href="tel:+15185733522"
            className="flex items-center gap-2 text-[var(--base1)] transition-colors hover:text-[var(--violet)]"
          >
            <PhoneIcon className="h-4 w-4 text-[var(--text-muted)]" /> 518-573-3522
          </a>
          <a
            href="https://linkedin.com/in/aaron-parisi"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-[var(--base1)] transition-colors hover:text-[var(--violet)]"
          >
            LinkedIn <ArrowUpRightIcon className="h-3.5 w-3.5" />
          </a>
        </div>

        {/* Scenery, not controls — the real theme/motion toggles live in
            the nav. */}
        <div aria-hidden="true" className="mt-10 flex items-center justify-center gap-4 opacity-90">
          {dashItems.map((item, i) => (
            <span
              key={i}
              className={
                item.type === "knob" ? "dash-knob" : item.type === "switch" ? "dash-switch" : "dash-led"
              }
              style={
                {
                  "--dash-color": item.color,
                  ...(item.angle ? { "--dash-angle": item.angle } : {}),
                } as CSSProperties
              }
            />
          ))}
        </div>

        <p className="mt-8 font-mono text-xs text-[var(--text-muted)]">
          © {year} Aaron Parisi. Built with React Router, TypeScript &amp; Tailwind, styled in
          Solarized.
        </p>
      </div>
    </footer>
  );
}
