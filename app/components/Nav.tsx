import { ThemeToggle } from "./ThemeToggle";
import { MotionToggle } from "./MotionToggle";

const links = [
  { href: "#about", label: "About" },
  { href: "#journey", label: "Journey" },
  { href: "#skills", label: "Skills" },
  { href: "#contact", label: "Contact" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg)]/85 backdrop-blur">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <a href="#top" className="font-mono text-sm font-semibold text-[var(--text-strong)]">
          aaron<span className="text-[var(--cyan)]">.</span>parisi
        </a>
        <div className="hidden items-center gap-6 font-mono text-sm text-[var(--text)] sm:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="transition-colors hover:text-[var(--blue)]">
              {l.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <MotionToggle />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
