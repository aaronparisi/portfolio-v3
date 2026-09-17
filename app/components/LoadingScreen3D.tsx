import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { animated, useSpring } from "@react-spring/web";
import {
  createAxesGroup,
  createGridBox,
  createSurfaceMesh,
  disposeObject3D,
  prepareRadialReveal,
  revealCountForRadius,
  springValue,
} from "~/three/createLoadingGraph";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const ENTER_DELAY = 5000;

// OrbitControls' autoRotateSpeed isn't in rad/sec -- per its own docs,
// a value of 2.0 is "30 seconds per orbit at 60fps," i.e. 2*PI radians
// per 30 seconds for every 2.0 of speed. Working in rad/sec ourselves
// and converting once here is easier to reason about than re-deriving
// this ratio wherever it's used. Confirmed by measuring
// getAzimuthalAngle() over time at a known autoRotateSpeed rather than
// assumed: a *positive* autoRotateSpeed produces a *decreasing*
// azimuthal angle -- this constant is a plain magnitude ratio, and the
// call site that converts a measured drag velocity back into an
// autoRotateSpeed value is the one that has to negate it.
const AUTOROTATE_UNITS_PER_RAD_PER_SEC = 2 / ((2 * Math.PI) / 30);
// The idle spin rate this settles back down to -- same 0.18 rad/sec as
// before, just expressed in OrbitControls' unit now.
const BASELINE_SPIN_SPEED = 0.18 * AUTOROTATE_UNITS_PER_RAD_PER_SEC;
// A cap on how much of a flick's momentum carries over, so a very fast
// drag can't leave the graph spinning absurdly quickly.
const MAX_SPIN_SPEED = BASELINE_SPIN_SPEED * 10;
// How quickly a flick's speed eases back down (or up) toward the
// baseline -- larger = faster settle.
const SPIN_DECAY_RATE = 1.4;

/**
 * The loading screen as a real multivariable calculus surface --
 * f(x, y) = 7xy / e^(x^2+y^2) -- rendered CalcPlot3D-style: a grid box,
 * colored axes sprouting from the origin, then the surface itself
 * repeatedly rendering outward from (0,0,0) and retracting back,
 * looping for as long as it takes someone to look at it. It's a real
 * THREE.js scene, not a video -- drag to orbit it (OrbitControls,
 * built into three itself, no extra dependency) any time, including
 * mid-animation. Idle, it slowly turns on its own; flick it while
 * dragging and it keeps coasting in that direction afterward, easing
 * back down to that same idle speed rather than snapping back to a
 * fixed default rotation.
 *
 * Unlike every other loading screen on this branch, this one doesn't
 * time itself out -- there's a real, if decorative, "load" happening
 * (constructing the geometry, compiling shaders), so after a few
 * seconds an "Enter the site" button appears and the visitor decides
 * when they're done watching it.
 *
 * All of the motion here -- the axis sprout, the auto-rotate, the
 * surface's grow/hold/shrink cycle -- is driven by springValue() (see
 * createLoadingGraph.ts), a closed-form damped-oscillator function
 * evaluated against elapsed time inside this component's own
 * requestAnimationFrame loop, not by react-spring. This loop isn't
 * driven by React renders at all, so wiring a second animation library
 * into it would add a layer of indirection (reading spring values back
 * out via .get() every frame) for no real benefit over just computing
 * the same physics directly. The "Enter" button below is normal DOM,
 * and does use react-spring, same as everywhere else on the page.
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
    camera.position.set(1.3, 3.9, 6.4);

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

    // Grid box, axes, and surface all live under one root -- purely
    // for scene organization and disposal now (see the note below on
    // why the idle/flick rotation itself moved to the camera instead
    // of spinning this group).
    const graphRoot = new THREE.Group();
    scene.add(graphRoot);

    graphRoot.add(createGridBox());

    const axes = createAxesGroup();
    graphRoot.add(axes.root);

    const surface = createSurfaceMesh();
    graphRoot.add(surface);
    // Sorts the surface's own triangles by distance from the origin and
    // hands back that sorted distance list -- draw range is then just
    // "how many of the nearest N triangles to show," which is what
    // makes the surface actually render outward ring by ring instead of
    // merely scaling an already-complete shape up and down.
    const sortedRadii = prepareRadialReveal(surface.geometry);
    const maxRadius = sortedRadii.length > 0 ? sortedRadii[sortedRadii.length - 1] : 1;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = 16;
    controls.target.set(0, 0, 0);

    if (import.meta.env.DEV) {
      // Dev-only inspection hook (matches OverheadProjector3D's
      // __projectorReview) so the momentum/direction behavior can be
      // measured directly instead of eyeballed from screenshots.
      (window as unknown as { __loadingGraphReview: unknown }).__loadingGraphReview = { controls, camera };
    }
    controls.update();

    // The idle/flick rotation drives the CAMERA (via OrbitControls'
    // own autoRotate), not the graph object. An earlier version spun
    // graphRoot.rotation.y directly instead, which read fine for a
    // constant idle spin but broke the moment "continue with the
    // drag's momentum" was needed: OrbitControls orbits the *camera*
    // around the graph, so a rightward drag and a "spin the object
    // rightward" both look similar but are opposite in sign, and
    // getting that conversion wrong would make the motion visibly
    // reverse direction at the exact moment the user releases. Doing
    // everything in camera-azimuth space sidesteps that entirely: the
    // same quantity (controls.getAzimuthalAngle()) is what a drag
    // changes, what autoRotate changes, and what gets measured and
    // fed back in on release, so there's nothing to convert or get
    // backwards.
    controls.autoRotate = true;
    controls.autoRotateSpeed = BASELINE_SPIN_SPEED;
    let currentSpinSpeed = BASELINE_SPIN_SPEED;
    let recentDragVelocity = 0; // rad/sec, smoothed, measured only while dragging
    let lastAzimuth = controls.getAzimuthalAngle();

    let userInteracting = false;
    const handleInteractionStart = () => {
      userInteracting = true;
      recentDragVelocity = 0;
      // Autorotate would otherwise keep adding its own contribution on
      // top of the drag, muddying the velocity being measured below.
      controls.autoRotate = false;
    };
    const handleInteractionEnd = () => {
      userInteracting = false;
      // Seed the coast with whatever was actually just measured,
      // capped, and pointed the same direction the drag was already
      // going -- a near-zero reading (a tap, or a drag that ended
      // stationary) falls back to continuing whatever direction was
      // already playing rather than snapping to a default.
      // Negated: measured directly (see AUTOROTATE_UNITS_PER_RAD_PER_SEC's
      // own comment) -- a *positive* autoRotateSpeed produces a
      // *decreasing* azimuthal angle, not an increasing one, so
      // reproducing the drag's own measured azimuth velocity with the
      // same sign would set the graph coasting backwards from the
      // direction it was just dragged in.
      const measured = -recentDragVelocity * AUTOROTATE_UNITS_PER_RAD_PER_SEC;
      const sign = Math.abs(measured) > 0.001 ? Math.sign(measured) : Math.sign(currentSpinSpeed || 1);
      currentSpinSpeed = sign * Math.min(MAX_SPIN_SPEED, Math.max(Math.abs(measured), BASELINE_SPIN_SPEED));
      controls.autoRotate = true;
      controls.autoRotateSpeed = currentSpinSpeed;
    };
    controls.addEventListener("start", handleInteractionStart);
    controls.addEventListener("end", handleInteractionEnd);

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
    let lastElapsed = 0;

    // The axes sprout once, staggered, and stay fully drawn -- only the
    // surface keeps looping after that, so the coordinate system reads
    // as "established" before the thing being graphed on it arrives.
    const AXIS_STAGGER = 0.15;
    const SURFACE_START = 1.1;
    const GROW_DURATION = 2.6;
    const HOLD_DURATION = 0.7;
    const SHRINK_DURATION = 2.0;
    const GAP_DURATION = 0.3;

    let phase: "grow" | "hold" | "shrink" | "gap" = "grow";
    let phaseStart = SURFACE_START;

    function tick() {
      if (disposed) return;
      const elapsed = (performance.now() - startTime) / 1000;
      const dt = Math.min(0.1, Math.max(0, elapsed - lastElapsed));
      lastElapsed = elapsed;

      const azimuth = controls.getAzimuthalAngle();
      const azDelta = azimuth - lastAzimuth;
      lastAzimuth = azimuth;

      if (userInteracting) {
        // Exponential smoothing so the very last, possibly-jittery
        // frame of a drag doesn't solely decide the release velocity.
        const instVelocity = dt > 0 ? azDelta / dt : 0;
        recentDragVelocity = recentDragVelocity * 0.72 + instVelocity * 0.28;
      } else {
        // Eases `currentSpinSpeed` back toward the signed baseline --
        // a flick starts fast (or slow) and settles to the same idle
        // rate as always, just still turning whichever way it was
        // last sent.
        const targetSpeed = Math.sign(currentSpinSpeed || 1) * BASELINE_SPIN_SPEED;
        currentSpinSpeed += (targetSpeed - currentSpinSpeed) * Math.min(1, dt * SPIN_DECAY_RATE);
        controls.autoRotateSpeed = currentSpinSpeed;
      }

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
        surface.geometry.setDrawRange(0, 0);
      } else {
        const t = elapsed - phaseStart;
        // Close to critically damped (friction ~= 2*sqrt(tension)) on
        // purpose -- real spring physics, but with the oscillation
        // tuned almost all the way out, since visible bounce here would
        // read as the reveal radius flickering in and out near the end
        // of each sweep instead of a clean, legible "spreading outward."
        // Tension is deliberately very low (typical UI springs on this
        // site run 100-300) -- this needs to be slow enough to actually
        // watch spread from the origin outward, not just visually
        // confirm it happened; the first attempt (tension 110) settled
        // in well under half a second, which read as the shape simply
        // appearing, not rendering.
        let p: number;
        if (phase === "grow") {
          p = springValue(t, 0, 1, 5, 4.5);
          if (t > GROW_DURATION) {
            phase = "hold";
            phaseStart = elapsed;
          }
        } else if (phase === "hold") {
          p = 1;
          if (t > HOLD_DURATION) {
            phase = "shrink";
            phaseStart = elapsed;
          }
        } else if (phase === "shrink") {
          p = springValue(t, 1, 0, 9, 6);
          if (t > SHRINK_DURATION) {
            phase = "gap";
            phaseStart = elapsed;
          }
        } else {
          p = 0;
          if (t > GAP_DURATION) {
            phase = "grow";
            phaseStart = elapsed;
          }
        }
        const clampedRadius = Math.max(0, Math.min(1, p)) * maxRadius;
        surface.geometry.setDrawRange(0, revealCountForRadius(sortedRadii, clampedRadius) * 3);
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
      controls.removeEventListener("start", handleInteractionStart);
      controls.removeEventListener("end", handleInteractionEnd);
      controls.dispose();
      renderer.dispose();
      disposeObject3D(graphRoot);
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
