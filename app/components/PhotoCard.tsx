import { useRef, type PointerEvent } from "react";
import { animated, to, useSpring } from "@react-spring/web";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

/**
 * The hero portrait: a photo card that tilts toward the cursor with real
 * spring physics (an overshoot-and-settle, not a linear follow) and
 * relaxes back to flat when the pointer leaves. A soft two-tone shape
 * sits offset behind it for depth.
 */
export function PhotoCard() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

  const [style, api] = useSpring(() => ({
    rx: 0,
    ry: 0,
    scale: 1,
    config: { tension: 260, friction: 18 },
  }));

  function handleMove(e: PointerEvent<HTMLDivElement>) {
    if (reduced) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    void api.start({ ry: px * 16, rx: -py * 16 });
  }

  function handleLeave() {
    void api.start({ rx: 0, ry: 0, scale: 1 });
  }

  return (
    <div className="relative mx-auto w-full max-w-[22rem]" style={{ perspective: "1400px" }}>
      <div
        aria-hidden="true"
        className="photo-blob absolute -inset-5 -z-10 rotate-3 rounded-[2.5rem] opacity-80"
      />
      <animated.div
        ref={ref}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        onPointerEnter={() => !reduced && void api.start({ scale: 1.015 })}
        className="aspect-[4/5] overflow-hidden rounded-[2rem] border border-[var(--border)] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.35)]"
        style={{
          transform: to(
            [style.rx, style.ry, style.scale],
            (rx, ry, s) => `rotateX(${rx}deg) rotateY(${ry}deg) scale(${s})`,
          ),
          transformStyle: "preserve-3d",
        }}
      >
        <img
          src="/images/aaron-photo.jpg"
          srcSet="/images/aaron-photo-sm.jpg 800w, /images/aaron-photo.jpg 1400w"
          sizes="(max-width: 640px) 90vw, 22rem"
          alt="Aaron Parisi"
          width={1050}
          height={1400}
          className="h-full w-full object-cover"
          style={{ objectPosition: "50% 48%" }}
        />
      </animated.div>
    </div>
  );
}
