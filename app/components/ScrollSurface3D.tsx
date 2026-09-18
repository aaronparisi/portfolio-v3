import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  createAxesGroup,
  createSurfaceMesh,
  createSurfaceWireframe,
  disposeObject3D,
  prepareRadialReveal,
  revealCountForRadius,
  springValue,
} from "~/three/createLoadingGraph";
import { computeGrayscaleColors, lerpColorBuffers } from "~/three/createScrollSurface";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const DRAG_SENSITIVITY = 0.008;
const IDLE_ROTATE_SPEED = 0.12; // rad/sec, slow ambient turn once booted

// Boot sequence timing.
const GLITCH_S = 0.5;
// Windows deliberately wide enough, and numerous enough, to overlap --
// dense coverage across the glitch phase reads as "flickering, mostly
// present," which is what a struggling-to-lock signal looks like. A
// narrower/sparser first pass (55ms x 5 across 500ms, barely 10% "on")
// read as a mostly-blank half second with the occasional blip instead,
// confirmed by screenshots landing in the (much larger) gaps between
// flashes almost every time.
const GLITCH_FLASH_COUNT = 8;
const GLITCH_FLASH_WINDOW_S = 0.09;
const AXIS_STAGGER_S = 0.09;
const RESOLVE_S = 1.1; // radial grow + grayscale-to-color, starts right after GLITCH_S

/**
 * The hero's persistent calculus surface -- the same f(x,y) = 7xy/e^(x²+y²)
 * shape as the loading screen (see createLoadingGraph.ts), booting up
 * from a glitchy, monochrome, half-formed state into full color: the
 * page's own "coming online" moment, replacing what was originally
 * asked of the hero photo before the photo moved elsewhere. Drag to
 * orbit; a slow ambient spin afterward keeps it feeling alive, the same
 * "always a little moving" language as PhotoCard's own idle float.
 *
 * Boot phases, driven by one requestAnimationFrame loop (not react-spring
 * -- same reasoning as the loading screen: this isn't React-render-driven
 * animation, and springValue() evaluated directly against elapsed time
 * needs no library):
 * 1. "glitch" (GLITCH_S): the surface flickers in and out at random
 *    partial reveals, jitters its rotation, and swaps between solid and
 *    wireframe-only -- a signal not yet locked.
 * 2. "resolve" (RESOLVE_S): the *real* reveal -- axes sprout, the
 *    surface grows outward ring by ring (prepareRadialReveal /
 *    revealCountForRadius, exactly the loading screen's own mechanic),
 *    while its vertex colors lerp from a precomputed grayscale buffer
 *    (computeGrayscaleColors) to the true Gruvbox colormap.
 * 3. "idle": fully resolved -- ambient auto-rotate, draggable.
 *
 * `onBootComplete` fires once, the instant phase 2 finishes, so Hero can
 * sequence the rest of its own reveal (equation, text, nav, scroll cue)
 * off of it instead of guessing a fixed delay that could drift out of
 * sync with this component's own timing constants.
 */
export function ScrollSurface3D({ onBootComplete }: { onBootComplete?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const onBootCompleteRef = useRef(onBootComplete);
  onBootCompleteRef.current = onBootComplete;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(1.3, 3.9, 6.4);
    camera.lookAt(0, 0, 0);

    // Transparent, not the loading screen's opaque --bg fill -- this
    // sits inside the hero over its own background/light cones, not as
    // a full-bleed scene of its own.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(4, 6, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-4, 2, -3);
    scene.add(fill);

    const graphRoot = new THREE.Group();
    graphRoot.scale.setScalar(0.62);
    scene.add(graphRoot);

    const axes = createAxesGroup();
    graphRoot.add(axes.root);

    const surface = createSurfaceMesh();
    graphRoot.add(surface);
    const wireframe = createSurfaceWireframe();
    graphRoot.add(wireframe);

    const sortedRadii = prepareRadialReveal(surface.geometry);
    const maxRadius = sortedRadii.length > 0 ? sortedRadii[sortedRadii.length - 1] : 1;

    const colorAttr = surface.geometry.getAttribute("color") as THREE.BufferAttribute;
    const finalColors = new Float32Array(colorAttr.array as Float32Array);
    const grayColors = computeGrayscaleColors(colorAttr);
    const liveColors = colorAttr.array as Float32Array;
    // Grayscale from the very first frame -- only the "resolve" phase's
    // own tick lerps this toward finalColors, so without setting it here
    // up front the entire "glitch" phase would render in full color
    // (confirmed: it did, on the first pass -- the color buffer was
    // never touched until resolve began), completely missing the
    // black-and-white half of "black and white, with glitches."
    liveColors.set(grayColors);
    colorAttr.needsUpdate = true;

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

    // Reduced motion: skip straight to the fully-resolved, static end
    // state (this codebase's usual immediate-true escape hatch) and
    // fire onBootComplete synchronously so Hero's own downstream
    // sequence isn't left waiting on an animation that will never play.
    if (reduced) {
      surface.geometry.setDrawRange(0, sortedRadii.length * 3);
      // The grayscale set above (needed so a *non*-reduced visitor's
      // very first glitch frame isn't full color) has to be undone here
      // -- this path never runs the resolve tick that would otherwise
      // restore it.
      liveColors.set(finalColors);
      colorAttr.needsUpdate = true;
      renderer.render(scene, camera);
      onBootCompleteRef.current?.();
      return () => {
        resizeObserver.disconnect();
        renderer.dispose();
        disposeObject3D(graphRoot);
        container.removeChild(renderer.domElement);
      };
    }

    let raf = 0;
    let disposed = false;
    let lastElapsed = 0;
    const startTime = performance.now();

    let phase: "glitch" | "resolve" | "idle" = "glitch";
    let bootCompleteFired = false;
    // Pre-rolled so the same random sequence of flash instants doesn't
    // need recomputing every frame -- each is a moment, in seconds since
    // boot start, at which the glitch briefly flashes something on.
    const flashTimes = Array.from({ length: GLITCH_FLASH_COUNT }, () => Math.random() * GLITCH_S).sort(
      (a, b) => a - b,
    );

    // Dragging state -- orbit only, no momentum/flick decay like the
    // loading screen's trackball. This is a page fixture you nudge, not
    // a centerpiece toy, so the simpler direct-drag behavior fits.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const worldUp = new THREE.Vector3(0, 1, 0);
    const cameraRightVec = new THREE.Vector3();

    function rotateByPixels(dx: number, dy: number) {
      cameraRightVec.setFromMatrixColumn(camera.matrixWorld, 0);
      const yawQuat = new THREE.Quaternion().setFromAxisAngle(worldUp, dx * DRAG_SENSITIVITY);
      const pitchQuat = new THREE.Quaternion().setFromAxisAngle(cameraRightVec, dy * DRAG_SENSITIVITY);
      graphRoot.quaternion.premultiply(yawQuat);
      graphRoot.quaternion.premultiply(pitchQuat);
    }

    function onPointerDown(e: PointerEvent) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      if (!dragging) return;
      rotateByPixels(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    }
    function onPointerUp() {
      dragging = false;
    }
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);

    function tick() {
      if (disposed) return;
      const elapsed = (performance.now() - startTime) / 1000;
      const dt = Math.min(0.1, Math.max(0, elapsed - lastElapsed));
      lastElapsed = elapsed;

      if (phase === "glitch") {
        // A flash is "on" for a brief window right after each rolled
        // instant -- outside those windows the surface sits fully
        // hidden, so it reads as a signal cutting in and out, not a
        // smooth fade.
        const inFlash = flashTimes.some((t) => elapsed >= t && elapsed < t + GLITCH_FLASH_WINDOW_S);
        if (inFlash) {
          const radius = 0.25 + Math.random() * 0.75;
          surface.geometry.setDrawRange(0, revealCountForRadius(sortedRadii, radius * maxRadius) * 3);
          wireframe.visible = Math.random() > 0.4;
          surface.visible = Math.random() > 0.3;
          // Reset each flash rather than accumulating, so it reads as
          // instability, not an actual spin.
          graphRoot.rotation.set((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.3, 0);
        } else {
          surface.geometry.setDrawRange(0, 0);
          wireframe.visible = false;
          surface.visible = true;
          graphRoot.rotation.set(0, 0, 0);
        }
        axes.root.scale.setScalar(0);

        if (elapsed >= GLITCH_S) {
          phase = "resolve";
          graphRoot.rotation.set(0, 0, 0);
          wireframe.visible = true;
          surface.visible = true;
        }
      } else if (phase === "resolve") {
        const t = elapsed - GLITCH_S;
        const axisList: Array<[THREE.Group, number]> = [
          [axes.worldXAxis, 0],
          [axes.worldZAxis, AXIS_STAGGER_S],
          [axes.worldYAxis, AXIS_STAGGER_S * 2],
        ];
        for (const [group, delay] of axisList) {
          const at = Math.max(0, t - delay);
          group.scale.setScalar(Math.max(0, springValue(at, 0, 1, 170, 18)));
        }
        axes.root.scale.setScalar(1);

        const growP = Math.max(0, Math.min(1, springValue(t, 0, 1, 24, 11)));
        surface.geometry.setDrawRange(0, revealCountForRadius(sortedRadii, growP * maxRadius) * 3);

        lerpColorBuffers(liveColors, grayColors, finalColors, growP);
        colorAttr.needsUpdate = true;

        if (t >= RESOLVE_S) {
          phase = "idle";
          surface.geometry.setDrawRange(0, sortedRadii.length * 3);
          liveColors.set(finalColors);
          colorAttr.needsUpdate = true;
          if (!bootCompleteFired) {
            bootCompleteFired = true;
            onBootCompleteRef.current?.();
          }
        }
      } else if (!dragging) {
        graphRoot.rotateY(IDLE_ROTATE_SPEED * dt);
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.dispose();
      disposeObject3D(graphRoot);
      container.removeChild(renderer.domElement);
    };
  }, [reduced]);

  return <div ref={containerRef} className="h-full w-full cursor-grab" />;
}
