import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildTrackGeometryPair, curvePoint, TRACK_SHAPES } from "~/three/createInfinityTrack";
import { springValue } from "~/utils/springValue";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

/**
 * The site's persistent 3D backdrop -- the same tiled light-beam
 * infinity track tuned in isolation on /infinity-preview
 * (InfinityTrack3D.tsx, left untouched), but rebuilt here as a fixed,
 * full-viewport layer that runs the whole way down the page instead of
 * living inside Hero alone. Three things happen purely off scroll
 * position (no mouse interaction at all -- see this file's own commit
 * message / the plan doc for why that's a deliberate scope cut):
 *
 * 1. The shape itself blends continuously from `TRACK_SHAPES.teacher`
 *    (the smooth, rounded, untwisted racetrack everything was tuned
 *    against) to `TRACK_SHAPES.coder` (tighter, flatter, spiraled) --
 *    two full tile geometries built once at mount with identical
 *    topology, lerped/slerped per tile every frame by `shapeT`, which
 *    just *is* the smoothed scroll progress. Cheap: no per-frame
 *    geometry rebuild, just arithmetic over already-flat typed arrays
 *    (see buildTrackGeometryPair's own comment).
 * 2. The camera, the tile material's color, and the glow strand's own
 *    base color all interpolate too, keyed off the same progress --
 *    see CAMERA_KEYFRAMES and the *_TEACHER/*_CODER color pairs below.
 * 3. The camera-relative tile blowout + Gruvbox color sweep that used
 *    to run on a periodic timer (still on the preview, currently
 *    disabled there) instead fires here on demand -- home.tsx bumps
 *    `pulseSignal` once each time a story beat scrolls into view
 *    (About, the timeline's pivot card, Skills), and this component
 *    just replays the exact same pulse mechanic already tuned there.
 */

const STATIONS = 130;
const TILES_AROUND = 20;
const TUBE_RADIUS = 0.34;
const TILE_GAP_FRACTION = 0.86;
const TILE_THICKNESS = 0.03;

const GROWTH_DURATION_S = 2.6;
const POP_WINDOW_S = 0.5;
const POP_TENSION = 260;
const POP_FRICTION = 13;

// How quickly `shapeT`/the camera/the scroll-linked spin catch up to
// their real scroll-driven targets -- a few frames of physical lag,
// same "everything settles like something physical" language as the
// rest of this site's springs, just exponentially smoothed here
// instead of react-spring-driven (this loop is plain
// requestAnimationFrame, not React state).
const PROGRESS_RESPONSIVENESS = 5; // per second

// Orientation: a slow ambient idle spin plus a much bigger turn tied
// directly to how far through the whole journey the visitor has
// scrolled -- "it moves as you scroll" needs to be the dominant read,
// with the idle spin only keeping it from ever looking perfectly still
// at rest.
const IDLE_YAW_SPEED = 0.05; // rad/s
const SCROLL_YAW_TURNS = 1.35; // full turns across progress 0..1
const IDLE_TILT_SPEED = 0.35; // rad/s
const IDLE_TILT_AMPLITUDE = 0.05; // rad
const BASE_TILT = 0.18; // rad, a gentle constant 3/4 angle rather than dead-on
const SCROLL_TILT_SHIFT = 0.22; // rad, added tilt by the end of the journey

interface CameraKeyframe {
  p: number;
  pos: [number, number, number];
  fov: number;
}
// Hero: close, high, centered. About: shifts right, pulls back a touch
// -- a "companion" position while text takes the main stage. The
// pivot/Timeline: swings left, pulls back further. Skills: settles
// back to center, furthest away, calmest -- the resolved "coder" form
// at rest.
const CAMERA_KEYFRAMES: CameraKeyframe[] = [
  { p: 0.0, pos: [0, 0.9, 6.0], fov: 42 },
  { p: 0.22, pos: [2.5, 0.25, 7.3], fov: 40 },
  { p: 0.55, pos: [-2.1, -0.3, 8.2], fov: 38 },
  { p: 1.0, pos: [0, 0.1, 9.3], fov: 36 },
];

function sampleCamera(p: number, out: { x: number; y: number; z: number; fov: number }) {
  let lo = CAMERA_KEYFRAMES[0];
  let hi = CAMERA_KEYFRAMES[CAMERA_KEYFRAMES.length - 1];
  for (let i = 0; i < CAMERA_KEYFRAMES.length - 1; i++) {
    if (p >= CAMERA_KEYFRAMES[i].p && p <= CAMERA_KEYFRAMES[i + 1].p) {
      lo = CAMERA_KEYFRAMES[i];
      hi = CAMERA_KEYFRAMES[i + 1];
      break;
    }
  }
  const span = hi.p - lo.p;
  const t = span > 0 ? (p - lo.p) / span : 0;
  out.x = lo.pos[0] + (hi.pos[0] - lo.pos[0]) * t;
  out.y = lo.pos[1] + (hi.pos[1] - lo.pos[1]) * t;
  out.z = lo.pos[2] + (hi.pos[2] - lo.pos[2]) * t;
  out.fov = lo.fov + (hi.fov - lo.fov) * t;
}

// Hover is gone here (no mouse interaction), but the pulse-driven
// "breaking through the plating" blowout survives wholesale --
// triggered externally now instead of a periodic timer.
const PULSE_DURATION_S = 2.2;
const PULSE_TILE_WINDOW = 0.04;
const PULSE_TILE_LIFT = 0.65;
const PULSE_CHAOS_ROTATION = 0.6;
const PULSE_GLOW_WINDOW = 0.09;
const GRUVBOX_HUES = ["#fb4934", "#fe8019", "#fabd2f", "#b8bb26", "#8ec07c", "#83a598", "#d3869b"];
const GRUVBOX_COLORS = GRUVBOX_HUES.map((hex) => new THREE.Color(hex));
function gruvboxColorAt(t: number, out: THREE.Color): THREE.Color {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (GRUVBOX_COLORS.length - 1);
  const i0 = Math.floor(scaled);
  const i1 = Math.min(GRUVBOX_COLORS.length - 1, i0 + 1);
  return out.copy(GRUVBOX_COLORS[i0]).lerp(GRUVBOX_COLORS[i1], scaled - i0);
}

const GLOW_POINT_COUNT = 260;
const GLOW_POINT_SIZE = TUBE_RADIUS * 3.2;
const GLOW_WAVE_COUNT = 14;
const GLOW_SCROLL_SPEED = 0.35;

// The palette blend: warm chalk-gold ("teacher") toward a cooler
// Gruvbox aqua/blue ("coder") -- the same shift from analog to digital
// the plan's original narrative called for, now living in color
// instead of a separate material system.
const TILE_COLOR_TEACHER = new THREE.Color(0x2b2622);
const TILE_COLOR_CODER = new THREE.Color(0x20282b);
const GLOW_COLOR_TEACHER = new THREE.Color(0xfabd2f);
const GLOW_COLOR_CODER = new THREE.Color(0x83a598);

// The fade-out: over the last stretch of progress, the whole layer
// eases its opacity to 0 so Footer reads as a clean, deliberate stop
// rather than fighting a giant WebGL canvas for attention.
const FADE_START = 0.92;

function createGlowSprite(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.7)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function Experience3D({
  progressRef,
  pulseSignal = 0,
  onBootComplete,
}: {
  progressRef: RefObject<number>;
  pulseSignal?: number;
  onBootComplete?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const onBootCompleteRef = useRef(onBootComplete);
  onBootCompleteRef.current = onBootComplete;

  // Bumped by home.tsx once per story beat (About/pivot/Skills scrolling
  // into view). The very first render's value shouldn't itself fire a
  // pulse -- only real increments after mount should.
  const pulseRequestedRef = useRef(false);
  const isFirstPulseSignal = useRef(true);
  useEffect(() => {
    if (isFirstPulseSignal.current) {
      isFirstPulseSignal.current = false;
      return;
    }
    pulseRequestedRef.current = true;
  }, [pulseSignal]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0.9, 6.0);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const key = new THREE.DirectionalLight(0xfff4e0, 1.5);
    key.position.set(5, 7, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xa8c8ff, 0.25);
    rim.position.set(-5, -2, -3);
    scene.add(rim);

    const pair = buildTrackGeometryPair(TRACK_SHAPES.teacher, TRACK_SHAPES.coder, STATIONS, TILES_AROUND, TUBE_RADIUS);
    const tileCount = pair.tileCount;

    const tileGeometry = new THREE.BoxGeometry(
      pair.tileWidth * TILE_GAP_FRACTION,
      pair.tileHeight * TILE_GAP_FRACTION,
      TILE_THICKNESS,
    );
    const tileMaterial = new THREE.MeshStandardMaterial({
      color: TILE_COLOR_TEACHER.clone(),
      metalness: 1,
      roughness: 0.2,
      envMapIntensity: 1.25,
    });
    const tileMesh = new THREE.InstancedMesh(tileGeometry, tileMaterial, tileCount);
    tileMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const trackRoot = new THREE.Group();
    trackRoot.add(tileMesh);
    scene.add(trackRoot);

    // The glow strand, same technique as the preview (soft additive
    // points on the curve's own centerline) but sampled from *both*
    // shapes so it blends right along with the tiles instead of only
    // following one fixed curve.
    const glowPositionsA = new Float32Array(GLOW_POINT_COUNT * 3);
    const glowPositionsB = new Float32Array(GLOW_POINT_COUNT * 3);
    const glowAlong = new Float32Array(GLOW_POINT_COUNT);
    const glowLive = new Float32Array(GLOW_POINT_COUNT * 3);
    const glowColors = new Float32Array(GLOW_POINT_COUNT * 3);
    const glowVec = new THREE.Vector3();
    for (let i = 0; i < GLOW_POINT_COUNT; i++) {
      const t = (i / GLOW_POINT_COUNT) * Math.PI * 2;
      curvePoint(TRACK_SHAPES.teacher, t, glowVec);
      glowPositionsA[i * 3] = glowVec.x;
      glowPositionsA[i * 3 + 1] = glowVec.y;
      glowPositionsA[i * 3 + 2] = glowVec.z;
      curvePoint(TRACK_SHAPES.coder, t, glowVec);
      glowPositionsB[i * 3] = glowVec.x;
      glowPositionsB[i * 3 + 1] = glowVec.y;
      glowPositionsB[i * 3 + 2] = glowVec.z;
      glowAlong[i] = i / GLOW_POINT_COUNT;
    }
    const glowGeometry = new THREE.BufferGeometry();
    const glowPositionAttr = new THREE.BufferAttribute(glowLive, 3);
    glowGeometry.setAttribute("position", glowPositionAttr);
    const glowColorAttr = new THREE.BufferAttribute(glowColors, 3);
    glowGeometry.setAttribute("color", glowColorAttr);

    const glowSprite = createGlowSprite();
    const glowMaterial = new THREE.PointsMaterial({
      map: glowSprite,
      size: GLOW_POINT_SIZE,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const glowPoints = new THREE.Points(glowGeometry, glowMaterial);
    trackRoot.add(glowPoints);

    const scratchColor = new THREE.Color();
    const rainbowColor = new THREE.Color();
    const glowBaseNow = new THREE.Color();

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

    const dummy = new THREE.Object3D();
    const poppedAt = new Float32Array(tileCount).fill(-1);
    const chaosSeeds = new Float32Array(tileCount).map(() => Math.random());
    const chaosAxis = new THREE.Vector3();
    const chaosQuat = new THREE.Quaternion();
    const quatScratch = [0, 0, 0, 1];

    function paintTile(i: number, growScale: number, lift: number, shapeT: number, chaosJitter = 0) {
      const i3 = i * 3;
      const i4 = i * 4;
      const ax = pair.positionsA[i3];
      const ay = pair.positionsA[i3 + 1];
      const az = pair.positionsA[i3 + 2];
      const bx = pair.positionsB[i3];
      const by = pair.positionsB[i3 + 1];
      const bz = pair.positionsB[i3 + 2];
      const px = ax + (bx - ax) * shapeT;
      const py = ay + (by - ay) * shapeT;
      const pz = az + (bz - az) * shapeT;

      const oax = pair.outwardA[i3];
      const oay = pair.outwardA[i3 + 1];
      const oaz = pair.outwardA[i3 + 2];
      const obx = pair.outwardB[i3];
      const oby = pair.outwardB[i3 + 1];
      const obz = pair.outwardB[i3 + 2];
      let ox = oax + (obx - oax) * shapeT;
      let oy = oay + (oby - oay) * shapeT;
      let oz = oaz + (obz - oaz) * shapeT;
      const olen = Math.hypot(ox, oy, oz) || 1;
      ox /= olen;
      oy /= olen;
      oz /= olen;

      dummy.position.set(px + ox * lift, py + oy * lift, pz + oz * lift);

      // slerpFlat's own types insist on number[], but its implementation
      // only ever does indexed reads -- a Float32Array satisfies that
      // identically at runtime, and casting here avoids either widening
      // quatA/quatB to real arrays (2600 tiles * 4 floats) or copying
      // out of them on every tile, every frame.
      THREE.Quaternion.slerpFlat(
        quatScratch,
        0,
        pair.quatA as unknown as number[],
        i4,
        pair.quatB as unknown as number[],
        i4,
        shapeT,
      );
      if (chaosJitter > 0) {
        chaosAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        chaosQuat.setFromAxisAngle(chaosAxis, (Math.random() - 0.5) * 2 * chaosJitter * PULSE_CHAOS_ROTATION);
        dummy.quaternion.set(quatScratch[0], quatScratch[1], quatScratch[2], quatScratch[3]).multiply(chaosQuat);
      } else {
        dummy.quaternion.set(quatScratch[0], quatScratch[1], quatScratch[2], quatScratch[3]);
      }
      dummy.scale.setScalar(growScale);
      dummy.updateMatrix();
      tileMesh.setMatrixAt(i, dummy.matrix);
    }

    const eulerScratch = new THREE.Euler();

    if (reduced) {
      // A single static, fully-grown resting frame in the "teacher"
      // shape/palette/framing -- no rAF loop at all.
      for (let i = 0; i < tileCount; i++) paintTile(i, 1, 0, 0);
      tileMesh.instanceMatrix.needsUpdate = true;
      tileMaterial.color.copy(TILE_COLOR_TEACHER);
      for (let i = 0; i < GLOW_POINT_COUNT; i++) {
        glowLive[i * 3] = glowPositionsA[i * 3];
        glowLive[i * 3 + 1] = glowPositionsA[i * 3 + 1];
        glowLive[i * 3 + 2] = glowPositionsA[i * 3 + 2];
        glowColors[i * 3] = GLOW_COLOR_TEACHER.r;
        glowColors[i * 3 + 1] = GLOW_COLOR_TEACHER.g;
        glowColors[i * 3 + 2] = GLOW_COLOR_TEACHER.b;
      }
      glowPositionAttr.needsUpdate = true;
      glowColorAttr.needsUpdate = true;
      camera.position.set(0, 0.9, 6.0);
      camera.fov = 42;
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0, 0);
      resize();
      renderer.render(scene, camera);
      onBootCompleteRef.current?.();
      return () => {
        resizeObserver.disconnect();
        renderer.dispose();
        tileGeometry.dispose();
        tileMaterial.dispose();
        glowGeometry.dispose();
        glowMaterial.dispose();
        glowSprite.dispose();
        pmrem.dispose();
        container.removeChild(renderer.domElement);
      };
    }

    if (import.meta.env.DEV) {
      (window as unknown as { __experience3DReview: unknown }).__experience3DReview = {
        camera,
        trackRoot,
        getState: () => ({
          shapeT: lastShapeT,
          smoothedProgress: lastSmoothedProgress,
          pulseActive,
          bootFired,
        }),
      };
    }

    let raf = 0;
    let disposed = false;
    let lastElapsed = 0;
    const startTime = performance.now();
    let smoothedProgress = 0;
    let lastShapeT = 0;
    let lastSmoothedProgress = 0;
    let bootFired = false;

    let pulseActive = false;
    let pulseStart = 0;

    const cameraSample = { x: 0, y: 0, z: 0, fov: 42 };

    function tick() {
      if (disposed || !container) return;
      const elapsed = (performance.now() - startTime) / 1000;
      const dt = Math.min(0.1, Math.max(0, elapsed - lastElapsed));
      lastElapsed = elapsed;

      const targetProgress = progressRef.current ?? 0;
      smoothedProgress += (targetProgress - smoothedProgress) * (1 - Math.exp(-PROGRESS_RESPONSIVENESS * dt));
      lastSmoothedProgress = smoothedProgress;
      const shapeT = smoothedProgress;
      lastShapeT = shapeT;

      // Orientation: idle ambient spin + a much larger turn tied to
      // scroll, plus a gentle tilt that shifts a little further open
      // by the end of the journey.
      const yaw = elapsed * IDLE_YAW_SPEED + smoothedProgress * SCROLL_YAW_TURNS * Math.PI * 2;
      const tilt = BASE_TILT + Math.sin(elapsed * IDLE_TILT_SPEED) * IDLE_TILT_AMPLITUDE + smoothedProgress * SCROLL_TILT_SHIFT;
      eulerScratch.set(tilt, yaw, 0, "XYZ");
      trackRoot.quaternion.setFromEuler(eulerScratch);

      sampleCamera(smoothedProgress, cameraSample);
      camera.position.set(cameraSample.x, cameraSample.y, cameraSample.z);
      camera.fov = cameraSample.fov;
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0, 0);

      tileMaterial.color.lerpColors(TILE_COLOR_TEACHER, TILE_COLOR_CODER, shapeT);
      glowBaseNow.lerpColors(GLOW_COLOR_TEACHER, GLOW_COLOR_CODER, shapeT);

      const frontier = Math.min(1, elapsed / GROWTH_DURATION_S);
      if (!bootFired && frontier >= 1) {
        bootFired = true;
        onBootCompleteRef.current?.();
      }

      // Pulse: only consumes a requested trigger once the track is
      // fully grown, same reasoning as the preview's own periodic
      // version -- a sweep across a still-forming loop would read as
      // broken, not deliberate.
      let pulseProgress = -1;
      if (frontier >= 1) {
        if (!pulseActive && pulseRequestedRef.current) {
          pulseActive = true;
          pulseStart = elapsed;
          pulseRequestedRef.current = false;
        }
        if (pulseActive) {
          const p = (elapsed - pulseStart) / PULSE_DURATION_S;
          if (p >= 1) {
            pulseActive = false;
          } else {
            pulseProgress = p;
          }
        }
      }

      for (let i = 0; i < tileCount; i++) {
        const along = pair.along[i];
        if (poppedAt[i] < 0 && along <= frontier) poppedAt[i] = elapsed;
        const growScale = poppedAt[i] < 0 ? 0 : Math.max(0, springValue(elapsed - poppedAt[i], 0, 1, POP_TENSION, POP_FRICTION));

        let lift = 0;
        let chaosJitter = 0;
        if (pulseProgress >= 0) {
          let d = Math.abs(along - pulseProgress);
          if (d > 0.5) d = 1 - d;
          if (d < PULSE_TILE_WINDOW) {
            const w = 1 - d / PULSE_TILE_WINDOW;
            lift = PULSE_TILE_LIFT * (0.4 + chaosSeeds[i] * 0.6) * w;
            chaosJitter = w;
          }
        }

        paintTile(i, growScale, lift, shapeT, chaosJitter);
      }
      tileMesh.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < GLOW_POINT_COUNT; i++) {
        const i3 = i * 3;
        const ax = glowPositionsA[i3];
        const ay = glowPositionsA[i3 + 1];
        const az = glowPositionsA[i3 + 2];
        const bx = glowPositionsB[i3];
        const by = glowPositionsB[i3 + 1];
        const bz = glowPositionsB[i3 + 2];
        glowLive[i3] = ax + (bx - ax) * shapeT;
        glowLive[i3 + 1] = ay + (by - ay) * shapeT;
        glowLive[i3 + 2] = az + (bz - az) * shapeT;

        const along = glowAlong[i];
        if (along > frontier) {
          glowColors[i3] = 0;
          glowColors[i3 + 1] = 0;
          glowColors[i3 + 2] = 0;
          continue;
        }
        const wave = 0.55 + 0.45 * Math.sin(along * GLOW_WAVE_COUNT * Math.PI * 2 - elapsed * GLOW_SCROLL_SPEED * Math.PI * 2);
        scratchColor.copy(glowBaseNow).multiplyScalar(wave);

        if (pulseProgress >= 0) {
          let delta = along - pulseProgress;
          if (delta > 0.5) delta -= 1;
          if (delta < -0.5) delta += 1;
          if (Math.abs(delta) < PULSE_GLOW_WINDOW) {
            const w = 1 - Math.abs(delta) / PULSE_GLOW_WINDOW;
            const bandT = delta / PULSE_GLOW_WINDOW / 2 + 0.5;
            gruvboxColorAt(bandT, rainbowColor);
            scratchColor.lerp(rainbowColor, w);
          }
        }

        glowColors[i3] = scratchColor.r;
        glowColors[i3 + 1] = scratchColor.g;
        glowColors[i3 + 2] = scratchColor.b;
      }
      glowPositionAttr.needsUpdate = true;
      glowColorAttr.needsUpdate = true;

      const fade = 1 - Math.min(1, Math.max(0, (smoothedProgress - FADE_START) / (1 - FADE_START)));
      container.style.opacity = String(fade);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      renderer.dispose();
      tileGeometry.dispose();
      tileMaterial.dispose();
      glowGeometry.dispose();
      glowMaterial.dispose();
      glowSprite.dispose();
      pmrem.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [reduced, progressRef]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      // z-0, not a negative z-index: confirmed directly, in a real
      // browser (not just this project's own unreliable headless test
      // setup), that a negative z-index here left the canvas fully
      // invisible -- existing, correctly sized, mounted with no errors,
      // just never painted. Negative z-index vs. plain non-positioned
      // content works fine LOCALLY (Hero's own light-cone divs do
      // exactly that, inside Hero's own `position: relative` section),
      // but this is a full page-root-level fixed layer competing against
      // ~5 unrelated ancestors (Nav, main, Footer, ...) at once -- a
      // much less bulletproof case. Explicit z-index both directions
      // instead: every real content layer above this one carries its
      // own `relative z-10` (see home.tsx/Footer.tsx) rather than this
      // one going negative.
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  );
}
