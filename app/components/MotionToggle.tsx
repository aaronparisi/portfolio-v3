import type { CSSProperties } from "react";
import { WavesIcon, WavesOffIcon } from "./icons";

export function MotionToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.getAttribute("data-motion") === "on" ? "off" : "on";
    root.setAttribute("data-motion", next);
    try {
      localStorage.setItem("motion", next);
    } catch {
      // Storage may be unavailable — the setting still applies for this
      // page view, it just won't persist.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle parallax motion"
      title="Toggle parallax"
      className="hud-toggle flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--border)] text-[var(--text)] transition-colors hover:border-[var(--lime-text)] hover:text-[var(--lime-text)]"
      style={{ "--dash-color": "var(--lime)" } as CSSProperties}
    >
      <WavesIcon className="motion-icon-on h-5 w-5" />
      <WavesOffIcon className="motion-icon-off h-5 w-5" />
    </button>
  );
}
