import { PinIcon, MailIcon, PhoneIcon, ArrowUpRightIcon, GitBranchIcon } from "./icons";
import { FloatingGlyphs, type Glyph } from "./FloatingGlyphs";

const glyphs: Glyph[] = [
  { symbol: "</>", top: "18%", left: "9%", size: "1.75rem", speed: 0.24, font: "mono" },
  { symbol: "git push", top: "78%", left: "86%", size: "1rem", speed: 0.36, font: "mono" },
  // One last equation, quietly, behind the sign-off.
  { symbol: "π", top: "48%", left: "44%", size: "1.5rem", speed: 0.16, font: "chalk", opacity: 0.1 },
  { icon: GitBranchIcon, top: "82%", left: "16%", size: "1.5rem", speed: 0.3, opacity: 0.18 },
];

// icon-glow (see app.css) turns each contact icon's own stroke color into
// a matching drop-shadow, so the row reads as lit dashboard indicators
// rather than plain muted glyphs.
const ICON_GLOW = "icon-glow h-4 w-4";

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
            <PinIcon className={`${ICON_GLOW} text-[var(--cyan)]`} /> Seattle, WA
          </span>
          <a
            href="mailto:parisi.aaron@gmail.com"
            className="flex items-center gap-2 text-[var(--base1)] transition-colors hover:text-[var(--violet)]"
          >
            <MailIcon className={`${ICON_GLOW} text-[var(--pink)]`} /> parisi.aaron@gmail.com
          </a>
          <a
            href="tel:+15185733522"
            className="flex items-center gap-2 text-[var(--base1)] transition-colors hover:text-[var(--violet)]"
          >
            <PhoneIcon className={`${ICON_GLOW} text-[var(--lime)]`} /> 518-573-3522
          </a>
          <a
            href="https://linkedin.com/in/aaron-parisi"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-[var(--base1)] transition-colors hover:text-[var(--violet)]"
          >
            LinkedIn <ArrowUpRightIcon className="icon-glow h-3.5 w-3.5 text-[var(--violet)]" />
          </a>
        </div>

        <p className="mt-10 font-mono text-xs text-[var(--text-muted)]">
          © {year} Aaron Parisi. Built with React Router, TypeScript &amp; Tailwind, styled in
          Solarized.
        </p>
      </div>
    </footer>
  );
}
