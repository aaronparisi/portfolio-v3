import { PinIcon, MailIcon, PhoneIcon, ArrowUpRightIcon, GitBranchIcon } from "./icons";
import { FloatingGlyphs, type Glyph } from "./FloatingGlyphs";

const glyphs: Glyph[] = [
  { symbol: "</>", top: "18%", left: "9%", size: "1.75rem", speed: 0.24, font: "mono" },
  { symbol: "git push", top: "78%", left: "86%", size: "1rem", speed: 0.36, font: "mono" },
  // One last equation, quietly, behind the sign-off.
  { symbol: "π", top: "48%", left: "44%", size: "1.5rem", speed: 0.16, font: "chalk", opacity: 0.1 },
  { icon: GitBranchIcon, top: "82%", left: "16%", size: "1.5rem", speed: 0.3, opacity: 0.18 },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer
      id="contact"
      className="relative overflow-hidden border-t border-[var(--border)] bg-[var(--bg-alt)] px-6 py-20"
    >
      <FloatingGlyphs glyphs={glyphs} className="text-[var(--text-muted)]" />

      <div className="relative z-10 mx-auto max-w-2xl text-center">
        <p className="font-mono text-sm text-[var(--cyan)]">// contact</p>
        <h2 className="mt-2 text-3xl font-bold text-[var(--text-strong)] sm:text-4xl">
          Let&rsquo;s Build Something
        </h2>
        <p className="mx-auto mt-4 max-w-md text-[var(--text)]">
          Open to frontend roles with room to grow alongside product and design.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 font-mono text-sm">
          <span className="flex items-center gap-2 text-[var(--text)]">
            <PinIcon className="h-4 w-4 text-[var(--text-muted)]" /> Seattle, WA
          </span>
          <a
            href="mailto:parisi.aaron@gmail.com"
            className="flex items-center gap-2 text-[var(--text)] transition-colors hover:text-[var(--blue)]"
          >
            <MailIcon className="h-4 w-4 text-[var(--text-muted)]" /> parisi.aaron@gmail.com
          </a>
          <a
            href="tel:+15185733522"
            className="flex items-center gap-2 text-[var(--text)] transition-colors hover:text-[var(--blue)]"
          >
            <PhoneIcon className="h-4 w-4 text-[var(--text-muted)]" /> 518-573-3522
          </a>
          <a
            href="https://linkedin.com/in/aaron-parisi"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-[var(--text)] transition-colors hover:text-[var(--blue)]"
          >
            LinkedIn <ArrowUpRightIcon className="h-3.5 w-3.5" />
          </a>
        </div>

        <p className="mt-12 font-mono text-xs text-[var(--text-muted)]">
          © {year} Aaron Parisi — built with React Router, TypeScript &amp; Tailwind, styled in
          Solarized.
        </p>
      </div>
    </footer>
  );
}
