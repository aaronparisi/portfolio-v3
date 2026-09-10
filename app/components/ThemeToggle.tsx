import { useEffect, useState } from "react";
import { animated, useSpring } from "@react-spring/web";
import { SunIcon, MoonIcon } from "./icons";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

export function ThemeToggle() {
  const reduced = usePrefersReducedMotion();
  // CSS (not this state) decides which icon is actually visible, keyed
  // off [data-theme] directly — so it's correct even before this effect
  // runs post-hydration. This state only drives the spring transition.
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);

  function toggle() {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    setDark(next === "dark");
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage may be unavailable (private browsing, etc.) — theme still
      // applies for this page view, it just won't persist.
    }
  }

  const { t } = useSpring({
    t: dark ? 1 : 0,
    immediate: reduced,
    config: { tension: 210, friction: 16 },
  });

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle color theme"
      className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--border)] text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
    >
      <span className="relative grid h-4 w-4 place-items-center">
        <animated.span
          className="absolute"
          style={{
            opacity: t.to((v) => 1 - v),
            transform: t.to((v) => `scale(${1 - v * 0.5}) rotate(${-v * 45}deg)`),
          }}
        >
          <SunIcon className="h-4 w-4" />
        </animated.span>
        <animated.span
          className="absolute"
          style={{
            opacity: t,
            transform: t.to((v) => `scale(${0.5 + v * 0.5}) rotate(${(1 - v) * -45}deg)`),
          }}
        >
          <MoonIcon className="h-4 w-4" />
        </animated.span>
      </span>
    </button>
  );
}
