import type { CSSProperties } from "react";
import { SunIcon, MoonIcon } from "./icons";

export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage may be unavailable (private browsing, etc.) — theme still
      // applies for this page view, it just won't persist.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle color theme"
      className="hud-toggle flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--border)] text-[var(--text)] transition-colors hover:border-[var(--pink-text)] hover:text-[var(--pink-text)]"
      style={{ "--dash-color": "var(--pink)" } as CSSProperties}
    >
      <SunIcon className="theme-icon-sun h-5 w-5" />
      <MoonIcon className="theme-icon-moon h-5 w-5" />
    </button>
  );
}
