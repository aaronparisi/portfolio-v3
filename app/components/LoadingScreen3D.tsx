import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { animated, useSpring } from "@react-spring/web";
import {
  createAxesGroup,
  createFloorGrid,
  createSurfaceMesh,
  disposeObject3D,
  springValue,
} from "~/three/createLoadingGraph";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const ENTER_DELAY = 5000;

/**
 * The loading screen as a real multivariable calculus surface --
 * f(x, y) = 7xy / e^(x^2+y^2) -- rendered CalcPlot3D-style: colored
 * axes sprout from the origin, then the surface itself repeatedly
 * grows outward from (0,0,0) and contracts back, looping for as long
 * as it takes someone to look at it. It's a real THREE.js scene, not a
 * video or a screenshot -- drag to orbit it (OrbitControls, built into
 * three itself, no extra dependency) the whole time, including while
 * it's still "loading."
 *
 * Unlike every other loading screen on this branch, this one doesn't
 * time itself out -- there's a real, if decorative, "load" happening
 * (constructing the geometry, compiling shaders), so after a few
 * seconds an "Enter the site" button appears and the visitor decides
 * when they're done watching it breathe.
 *
 * All of the motion here -- the axis sprout, the surface's grow/hold/
 * shrink cycle -- is driven by springValue() (see createLoadingGraph.ts),
 * a closed-form damped-oscillator function evaluated against elapsed
 * time inside this component's own requestAnimationFrame loop, not by
 * react-spring. This loop isn't driven by React renders at all, so
 * wiring a second animation library into it would add a layer of
 * indirection (reading spring values back out via .get() every frame)
 * for no real benefit over just computing the same physics directly.
 * The "Enter" button below is normal DOM, and does use react-spring,
 * same as everywhere else on the page.
 */
export function LoadingScreen3D({ onComplete }: { onComplete: () => void }) {
  const reduced = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (reduced) onComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  useEffect(() => {
    if (reduced) return;
    const timer = window.setTimeout(() => setReady(true), ENTER_DELAY);
    return () => window.clearTimeout(timer);
  }, [reduced]);

  useEffect(() => {
    if (reduced) return;
    const container = containerRef.current;
    if (!container) return;

    const bgHex = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#282828";
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(bgHex);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    // f's peaks/troughs run along the x=y and x=-y diagonals -- a
    // camera positioned with world X and world Z nearly equal looks
    // straight down that ridge line and foreshortens almost all of the
    // height variation into what reads as a flat plane. Deliberately
    // asymmetric X/Z instead, so the default view actually cuts across
    // the saddle shape rather than along it.
    camera.position.set(1.4, 4.6, 7.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setClearColor(new THREE.Color(bgHex), 1);
    container.appendChild(renderer.domElement);

    // Neutral white throughout, not warm-tinted -- the surface's vertex
    // colors are the whole point (a diverging Gruvbox colormap), and a
    // warm key light shifts blue toward green/olive by the time it's
    // multiplied through (confirmed: the peaks, near Gruvbox's muted
    // teal-blue #83a598 at their highest, rendered olive-green instead
    // of reading as blue at all). Lights are for shading/depth here,
    // not for adding their own color into the mix.
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(4, 6, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-4, 2, -3);
    scene.add(fill);

    const grid = createFloorGrid();
    scene.add(grid);

    const axes = createAxesGroup();
    scene.add(axes.root);

    const surface = createSurfaceMesh();
    const surfaceGroup = new THREE.Group();
    surfaceGroup.add(surface);
    surfaceGroup.scale.setScalar(0);
    scene.add(surfaceGroup);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = 16;
    controls.target.set(0, 0, 0);
    controls.update();

    function resize() {
      if (!container) return;
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    let raf = 0;
    let disposed = false;
    // performance.now()-based elapsed time, not THREE.Clock (deprecated
    // in this three version in favor of THREE.Timer -- a manual delta
    // is simpler than adopting a whole new clock API for one number).
    const startTime = performance.now();

    // The axes sprout once, staggered, and stay fully drawn -- only the
    // surface keeps looping after that, so the coordinate system reads
    // as "established" before the thing being graphed on it arrives.
    const AXIS_STAGGER = 0.15;
    const SURFACE_START = 1.1;
    const GROW_DURATION = 1.0;
    const HOLD_DURATION = 0.5;
    const SHRINK_DURATION = 0.9;
    const GAP_DURATION = 0.3;

    let phase: "grow" | "hold" | "shrink" | "gap" = "grow";
    let phaseStart = SURFACE_START;

    function tick() {
      if (disposed) return;
      const elapsed = (performance.now() - startTime) / 1000;

      const axisList: Array<[THREE.Group, number]> = [
        [axes.worldXAxis, 0],
        [axes.worldZAxis, AXIS_STAGGER],
        [axes.worldYAxis, AXIS_STAGGER * 2],
      ];
      for (const [group, delay] of axisList) {
        const t = Math.max(0, elapsed - delay);
        group.scale.setScalar(Math.max(0, springValue(t, 0, 1, 170, 18)));
      }

      if (elapsed < SURFACE_START) {
        surfaceGroup.scale.setScalar(0);
      } else {
        const t = elapsed - phaseStart;
        let s: number;
        if (phase === "grow") {
          s = springValue(t, 0, 1, 130, 15);
          if (t > GROW_DURATION) {
            phase = "hold";
            phaseStart = elapsed;
          }
        } else if (phase === "hold") {
          s = 1;
          if (t > HOLD_DURATION) {
            phase = "shrink";
            phaseStart = elapsed;
          }
        } else if (phase === "shrink") {
          s = springValue(t, 1, 0, 190, 22);
          if (t > SHRINK_DURATION) {
            phase = "gap";
            phaseStart = elapsed;
          }
        } else {
          s = 0;
          if (t > GAP_DURATION) {
            phase = "grow";
            phaseStart = elapsed;
          }
        }
        surfaceGroup.scale.setScalar(Math.max(0, s));
      }

      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      disposeObject3D(axes.root);
      disposeObject3D(surfaceGroup);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      container.removeChild(renderer.domElement);
    };
  }, [reduced]);

  function handleEnter() {
    setExiting(true);
    window.setTimeout(onComplete, 450);
  }

  const button = useSpring({
    opacity: ready && !exiting ? 1 : 0,
    y: ready && !exiting ? 0 : 16,
    config: { tension: 210, friction: 20 },
  });

  const stage = useSpring({
    opacity: exiting ? 0 : 1,
    config: { tension: 210, friction: 26 },
  });

  return (
    <animated.div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-end pb-16 sm:pb-24"
      style={{ background: "var(--bg)", opacity: stage.opacity }}
      role="status"
      aria-label="Loading"
    >
      <div
        ref={containerRef}
        className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
        role="img"
        aria-label="A rotating 3D graph of a multivariable calculus surface. Drag to orbit it."
      />
      <animated.div
        className="relative z-10"
        style={{
          opacity: button.opacity,
          transform: button.y.to((y) => `translate3d(0, ${y}px, 0)`),
          pointerEvents: ready && !exiting ? "auto" : "none",
        }}
      >
        <button type="button" onClick={handleEnter} className="btn-primary rounded-full px-8 py-3 font-medium">
          Enter the site
        </button>
      </animated.div>
      <span className="sr-only">Loading the page.</span>
    </animated.div>
  );
}
