import { useEffect, useState } from "react";
import { animated, useSpring } from "@react-spring/web";
import { WavesIcon, WavesOffIcon } from "./icons";

export function MotionToggle() {
  // CSS doesn't drive which icon shows here the way ThemeToggle's icons
  // could — this one needs its transition timing to depend on which
  // direction it's switching, which has to live in JS. That means a
  // possible one-frame default before this effect corrects it, same
  // tradeoff ThemeToggle makes.
  const [on, setOn] = useState(true);

  useEffect(() => {
    setOn(document.documentElement.getAttribute("data-motion") !== "off");
  }, []);

  function toggle() {
    const root = document.documentElement;
    const next = root.getAttribute("data-motion") === "off" ? "on" : "off";
    root.setAttribute("data-motion", next);
    setOn(next === "on");
    try {
      localStorage.setItem("motion", next);
    } catch {
      // Storage may be unavailable — the setting still applies for this
      // page view, it just won't persist.
    }
  }

  // Turning motion OFF must not itself animate — that would rather
  // defeat the point — but turning it back ON should read clearly, so
  // it gets a noticeably bouncy morph. `immediate` is keyed on the
  // state being switched *to*, so that asymmetry just falls out of the
  // one spring rather than needing separate on/off code paths.
  const { t } = useSpring({
    t: on ? 1 : 0,
    immediate: !on,
    config: { tension: 300, friction: 10 },
  });

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle motion"
      title="Toggle motion"
      className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--border)] text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
    >
      <span className="relative grid h-4 w-4 place-items-center">
        <animated.span
          className="absolute"
          style={{
            opacity: t,
            transform: t.to((v) => `scale(${0.5 + v * 0.5}) rotate(${(1 - v) * 50}deg)`),
          }}
        >
          <WavesIcon className="h-4 w-4" />
        </animated.span>
        <animated.span
          className="absolute"
          style={{
            opacity: t.to((v) => 1 - v),
            transform: t.to((v) => `scale(${1 - v * 0.5}) rotate(${v * -50}deg)`),
          }}
        >
          <WavesOffIcon className="h-4 w-4" />
        </animated.span>
      </span>
    </button>
  );
}
