import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { animated, useSpring } from "@react-spring/web";
import {
  createAxesGroup,
  createSurfaceMesh,
  createSurfaceWireframe,
  disposeObject3D,
  prepareRadialReveal,
  revealCountForRadius,
  springValue,
} from "~/three/createLoadingGraph";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";
import { EnterSiteButton } from "~/components/EnterSiteButton";

// How long the "Enter the site" button stays disabled, showing a
// bouncing "Loading" ellipsis instead -- there's nothing real being
// waited on here (same as the rest of this screen), it's purely
// decorative pacing so the button doesn't feel clickable before the
// visitor has had a beat to actually look at the graph.
const ENTER_DELAY = 6000;
// The button itself appears much sooner than that -- it's just
// disabled/grayed out for the remainder of ENTER_DELAY, not hidden.
const BUTTON_ENTRANCE_DELAY = 400;

// Radians of graph rotation per pixel of drag -- the one sensitivity
// constant both live dragging and the post-release momentum replay
// share (see rotateGraphByPixels below), so they're guaranteed to feel
// like the same motion rather than two independently-tuned ones.
const DRAG_SENSITIVITY = 0.008;
// Idle speed, expressed as an equivalent px/sec of drag (so it runs
// through the exact same rotateGraphByPixels() conversion) -- picked to
// reproduce the previous 0.18 rad/sec baseline: 0.18 / DRAG_SENSITIVITY.
const BASELINE_SPEED_PX = 22.5;
const MAX_FLICK_SPEED_PX = 900;
const MIN_FLICK_SPEED_PX = 4;
// Very low tension, close to critically damped (friction ~= 2*sqrt(tension))
// -- a slow, non-oscillating decay on purpose, per feedback that the
// previous attempt slowed down too abruptly. This is the same
// closed-form springValue() the surface reveal uses, just decaying a
// scalar speed instead of a reveal fraction.
const MOMENTUM_TENSION = 4;
const MOMENTUM_FRICTION = 4;

/**
 * The loading screen as a real multivariable calculus surface --
 * f(x, y) = 7xy / e^(x^2+y^2) -- rendered CalcPlot3D-style: a grid box,
 * colored axes sprouting from the origin, then the surface itself
 * repeatedly rendering outward from (0,0,0) and retracting back,
 * looping for as long as it takes someone to look at it. It's a real
 * THREE.js scene, not a video -- drag to tumble it freely in any
 * direction (a hand-rolled quaternion trackball, not OrbitControls:
 * OrbitControls' azimuth/polar parametrization clamps the polar angle
 * to [0, pi], so it physically can't rotate past "straight up" without
 * getting stuck there, and it only ever exposes momentum around the
 * azimuthal axis -- neither works for "spin it any which way and have
 * it keep going that way"). Idle, it slowly turns on its own; flick it
 * while dragging and it keeps coasting in that exact direction and
 * speed afterward, easing back down to that same idle speed rather
 * than snapping back to a fixed default rotation.
 *
 * Unlike every other loading screen on this branch, this one doesn't
 * time itself out on its own -- there's a real, if decorative, "load"
 * happening (constructing the geometry, compiling shaders), so an
 * "Enter the site" button appears almost immediately but stays
 * disabled (see EnterSiteButton) for a few seconds before the visitor
 * can actually use it.
 *
 * All of the motion here -- the axis sprout, the auto-rotate, the
 * surface's grow/hold/shrink cycle -- is driven by springValue() (see
 * createLoadingGraph.ts), a closed-form damped-oscillator function
 * evaluated against elapsed time inside this component's own
 * requestAnimationFrame loop, not by react-spring. This loop isn't
 * driven by React renders at all, so wiring a second animation library
 * into it would add a layer of indirection (reading spring values back
 * out via .get() every frame) for no real benefit over just computing
 * the same physics directly. EnterSiteButton below is normal DOM, and
 * does use react-spring, same as everywhere else on the page.
 */
export function LoadingScreen3D({ onComplete }: { onComplete: () => void }) {
  const reduced = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [buttonVisible, setButtonVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (reduced) onComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  useEffect(() => {
    if (reduced) return;
    const visibleTimer = window.setTimeout(() => setButtonVisible(true), BUTTON_ENTRANCE_DELAY);
    const readyTimer = window.setTimeout(() => setReady(true), ENTER_DELAY);
    return () => {
      window.clearTimeout(visibleTimer);
      window.clearTimeout(readyTimer);
    };
  }, [reduced]);

  useEffect(() => {
    if (reduced) return;
    const container = containerRef.current;
    if (!container) return;

    // performance.now()-based elapsed time, not THREE.Clock (deprecated
    // in this three version in favor of THREE.Timer -- a manual delta
    // is simpler than adopting a whole new clock API for one number).
    // Declared up front since both the render loop and the pointer-up
    // handler (for stamping a release time) need it.
    const startTime = performance.now();

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

    // Axes and surface (grid lines live directly on the surface mesh
    // itself, see createSurfaceWireframe) share one root, both for
    // scene organization/disposal and so rotateGraphByPixels() below
    // can turn the whole thing with a single quaternion.
    const graphRoot = new THREE.Group();
    // Scaled down so the axes read as a compact loading graphic rather
    // than filling most of the screen -- per feedback that the graph
    // felt "large and imposing" at full size.
    graphRoot.scale.setScalar(0.5);
    scene.add(graphRoot);

    const axes = createAxesGroup();
    graphRoot.add(axes.root);

    const surface = createSurfaceMesh();
    graphRoot.add(surface);
    graphRoot.add(createSurfaceWireframe());
    // Sorts the surface's own triangles by distance from the origin and
    // hands back that sorted distance list -- draw range is then just
    // "how many of the nearest N triangles to show," which is what
    // makes the surface actually render outward ring by ring instead of
    // merely scaling an already-complete shape up and down.
    const sortedRadii = prepareRadialReveal(surface.geometry);
    const maxRadius = sortedRadii.length > 0 ? sortedRadii[sortedRadii.length - 1] : 1;

    camera.lookAt(0, 0, 0);
    // Zoom is the only thing the camera itself still does -- distance
    // from the origin only, along whatever direction lookAt just set,
    // so this never needs to touch orientation at all.
    let cameraDistance = camera.position.length();
    const MIN_DISTANCE = 3;
    const MAX_DISTANCE = 16;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      cameraDistance = THREE.MathUtils.clamp(cameraDistance + e.deltaY * 0.01, MIN_DISTANCE, MAX_DISTANCE);
      camera.position.setLength(cameraDistance);
    }
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    // Free rotation, any axis, no poles: each drag frame composes a
    // small yaw (around world-up) and pitch (around the camera's own
    // right vector, read straight off its world matrix) and
    // premultiplies it onto the graph's current orientation. Premultiply
    // (not multiply) applies the new rotation in world/camera space,
    // which is what makes dragging feel the same regardless of how the
    // graph has already been spun, rather than drifting like a
    // badly-set-up gimbal.
    const worldUp = new THREE.Vector3(0, 1, 0);
    const cameraRightVec = new THREE.Vector3();
    function rotateGraphByPixels(dx: number, dy: number) {
      cameraRightVec.setFromMatrixColumn(camera.matrixWorld, 0);
      // Positive, not negated -- confirmed backwards by feedback (the
      // graph turned opposite the drag), and it's the intuitive
      // "grab and turn" direction: dragging right should carry the
      // near surface to the right along with the pointer.
      const yawQuat = new THREE.Quaternion().setFromAxisAngle(worldUp, dx * DRAG_SENSITIVITY);
      const pitchQuat = new THREE.Quaternion().setFromAxisAngle(cameraRightVec, dy * DRAG_SENSITIVITY);
      graphRoot.quaternion.premultiply(yawQuat);
      graphRoot.quaternion.premultiply(pitchQuat);
    }

    // `dragging` tracks the OS-level gesture (from pointerdown to
    // whenever a real pointerup/pointercancel eventually fires).
    // `liveInputActive` tracks something subtly different: whether
    // we're actually still receiving fresh movement right now, which is
    // what should gate live-drag vs. momentum-replay in tick() below --
    // see STALE_TIMEOUT_MS just below for why these two can't just be
    // the same flag.
    let dragging = false;
    let liveInputActive = false;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let lastMoveTime = 0;

    // Speed is tracked as a "peak hold with decay" envelope, not a
    // trailing time window and not a recency-weighted exponential
    // smooth -- both of those were tried and both broke on an
    // extremely common real gesture: a hand naturally decelerating or
    // pausing for a moment right before actually lifting the mouse
    // button. The exponential version reacts downward just as fast as
    // upward, so a couple of near-zero-delta samples right at the end
    // erased the drag's real speed entirely; the windowed version
    // depends on enough samples actually landing inside an arbitrary
    // time window, which a pause of any length comparable to the
    // window defeats just as badly (and made this hard to even test
    // reliably, since simulated pointer events don't land at
    // perfectly even intervals). A peak-hold jumps UP instantly to
    // match any new fast instant, but only decays slowly otherwise --
    // confirmed by simulating a fast drag followed by a deliberate
    // 100-250ms pause before release: the earlier approaches both
    // measured a release speed collapsed to barely above the idle
    // baseline (which is what actually produced the reported "stops
    // for a moment," since coasting at that baseline is slow enough to
    // read as stopped); this one still remembers the drag was fast a
    // moment ago.
    const PEAK_HOLD_HALF_LIFE_MS = 180;
    let trackedSpeed = 0;
    let trackedDirX = 1;
    let trackedDirY = 0;

    // macOS's three-finger-drag trackpad gesture is a whole separate
    // problem from the peak-hold logic above, and needed its own fix:
    // it's an OS-level accessibility feature that keeps the virtual
    // pointer "down" for a few hundred ms after your fingers actually
    // lift the trackpad (so you can reposition mid-drag without a fresh
    // click), and the page genuinely receives zero events -- no
    // pointermove, no pointerup -- for that entire gap. From here it's
    // indistinguishable from someone holding the pointer perfectly
    // still, so the graph correctly freezes... and then the OS finally
    // delivers the real pointerup and it correctly un-freezes, which is
    // exactly the reported "stops for a moment, then continues right"
    // symptom. There's no event to wait for that arrives any sooner --
    // instead, treat an unusually long gap since the last pointermove
    // (while nominally still dragging) as an effective release. A real,
    // continuously-moving drag delivers pointermove events roughly every
    // 8-16ms (matched to display refresh or faster), so even a fairly
    // small threshold here comfortably clears normal event spacing; 50ms
    // is over 3x that, while still resolving the OS's few-hundred-ms
    // delay much faster than the original 120ms did. If an ordinary
    // brief pause mid-drag (someone's hand just hesitating) ever
    // misfires it, the consequence is only a brief, harmless coast that
    // gets overridden the instant real movement resumes (onPointerMove
    // sets liveInputActive back to true unconditionally) -- so there's
    // room to tune this lower still if 50ms ever proves not aggressive
    // enough.
    const STALE_TIMEOUT_MS = 50;

    // Momentum is that tracked (direction, speed) pair, replayed every
    // idle frame through the exact same rotateGraphByPixels() the live
    // drag uses, so the replay is guaranteed to match, not just
    // resemble, the live motion, with the speed easing down toward the
    // baseline via springValue(), parametrized by time-since-release --
    // not recomputed from a moving target every frame, so there's no
    // "settles at zero, then restarts" seam: it's always actually
    // turning, at some point between the release speed and baseline.
    let momentumDirX = 1;
    let momentumDirY = 0;
    let releaseSpeed = BASELINE_SPEED_PX;
    let releaseTime = 0;
    let hasReleased = false;

    // Shared by the real pointerup/pointercancel AND the stale-timeout
    // check in tick() below -- whichever notices the movement has
    // actually stopped first is the one that gets to seed the coast;
    // the other is then just a no-op (guarded by liveInputActive
    // already being false).
    function finalizeMomentum() {
      if (trackedSpeed > MIN_FLICK_SPEED_PX) {
        momentumDirX = trackedDirX;
        momentumDirY = trackedDirY;
        releaseSpeed = Math.min(trackedSpeed, MAX_FLICK_SPEED_PX);
      } else {
        // A tap, or a drag that ended stationary long enough for the
        // peak-hold itself to decay -- keep whatever direction was
        // already playing rather than resetting it, and don't let the
        // speed drop below the idle baseline.
        releaseSpeed = Math.max(releaseSpeed, BASELINE_SPEED_PX);
      }
      releaseTime = (performance.now() - startTime) / 1000;
      hasReleased = true;
    }

    function onPointerDown(e: PointerEvent) {
      dragging = true;
      liveInputActive = true;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      lastMoveTime = performance.now();
      trackedSpeed = 0;
      renderer.domElement.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      if (!dragging) return;
      // Covers resuming after the stale-timeout already soft-released
      // this gesture below -- if real movement comes back (someone
      // genuinely paused mid-drag rather than actually letting go),
      // hand control straight back to live input.
      liveInputActive = true;
      const now = performance.now();
      const dtMs = Math.max(1, now - lastMoveTime);
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      rotateGraphByPixels(dx, dy);

      const dist = Math.hypot(dx, dy);
      const instSpeed = (dist / dtMs) * 1000;
      const decay = Math.pow(0.5, dtMs / PEAK_HOLD_HALF_LIFE_MS);
      trackedSpeed = Math.max(instSpeed, trackedSpeed * decay);
      // Only real motion gets to set the direction -- a near-zero-delta
      // sample (exactly the kind a pause produces) shouldn't overwrite
      // which way the drag was actually heading.
      if (dist > 0.5) {
        trackedDirX = dx / dist;
        trackedDirY = dy / dist;
      }

      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      lastMoveTime = now;
    }
    function onPointerUp(e: PointerEvent) {
      if (!dragging) return;
      dragging = false;
      try {
        renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      // If the stale-timeout already caught this (the ordinary case for
      // a three-finger-drag release, where this event arrives a few
      // hundred ms after movement actually stopped), momentum has
      // already been seeded and re-finalizing here would just stomp on
      // however far it's already decayed.
      if (liveInputActive) {
        liveInputActive = false;
        finalizeMomentum();
      }
    }
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);

    if (import.meta.env.DEV) {
      // Dev-only inspection hook (matches OverheadProjector3D's
      // __projectorReview) so the momentum/direction behavior can be
      // measured directly instead of eyeballed from screenshots.
      (window as unknown as { __loadingGraphReview: unknown }).__loadingGraphReview = {
        camera,
        graphRoot,
        getMomentumState: () => ({
          dragging,
          liveInputActive,
          momentumDirX,
          momentumDirY,
          releaseSpeed,
          releaseTime,
          hasReleased,
          trackedSpeed,
          elapsed: (performance.now() - startTime) / 1000,
        }),
      };
    }

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

      // See STALE_TIMEOUT_MS's own comment: while the OS still reports
      // the pointer as down but no pointermove has arrived in a while,
      // treat it as an effective release rather than waiting on an
      // event that (for a three-finger-drag release) may not arrive for
      // several hundred more ms.
      if (dragging && liveInputActive && performance.now() - lastMoveTime > STALE_TIMEOUT_MS) {
        liveInputActive = false;
        finalizeMomentum();
      }

      if (!liveInputActive) {
        // Before the first release, there's nothing to decay from --
        // just the constant baseline, in the default direction (1, 0).
        // After a release, springValue() computes the current speed
        // fresh each frame from time-since-release, so it's a pure
        // function of elapsed time, not a per-frame recursive decay --
        // continuous by construction (t=0 gives back releaseSpeed
        // exactly) and never needs to "reach zero and restart."
        const currentSpeed = hasReleased
          ? springValue(elapsed - releaseTime, releaseSpeed, BASELINE_SPEED_PX, MOMENTUM_TENSION, MOMENTUM_FRICTION)
          : BASELINE_SPEED_PX;
        rotateGraphByPixels(momentumDirX * currentSpeed * dt, momentumDirY * currentSpeed * dt);
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

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.dispose();
      disposeObject3D(graphRoot);
      container.removeChild(renderer.domElement);
    };
  }, [reduced]);

  function handleEnter() {
    // The button's own `disabled` attribute already prevents this from
    // firing before `ready`, but a disabled check costs nothing extra
    // to keep here too.
    if (!ready) return;
    setExiting(true);
    window.setTimeout(onComplete, 450);
  }

  const button = useSpring({
    opacity: buttonVisible && !exiting ? 1 : 0,
    y: buttonVisible && !exiting ? 0 : 16,
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
        aria-label="A rotating 3D graph of a multivariable calculus surface. Drag to spin it in any direction."
      />
      <animated.div
        className="relative z-10"
        style={{
          opacity: button.opacity,
          transform: button.y.to((y) => `translate3d(0, ${y}px, 0)`),
          pointerEvents: buttonVisible && !exiting ? "auto" : "none",
        }}
      >
        <EnterSiteButton disabled={!ready} onClick={handleEnter} />
      </animated.div>
      <span className="sr-only">Loading the page.</span>
    </animated.div>
  );
}
