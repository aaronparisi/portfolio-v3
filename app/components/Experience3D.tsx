import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js";
import { buildTrackGeometrySet, curvePoint, TRACK_SHAPES } from "~/three/createInfinityTrack";
import { springValue } from "~/utils/springValue";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

/**
 * The site's persistent 3D backdrop -- the same tiled light-beam
 * infinity track tuned in isolation on /infinity-preview
 * (InfinityTrack3D.tsx, left untouched), rebuilt as a fixed, full-
 * viewport layer that runs the whole way down the page. Three things
 * happen, none of them on a timer:
 *
 * 1. The shape itself morphs through `TRACK_SHAPES` (createInfinityTrack
 *    .ts) -- the chalk-era lemniscate, a monitor-bezel rounded
 *    rectangle, an angular "circuit" loop -- as a function of overall
 *    scroll progress. All three share identical topology/tile count, so
 *    this is a cheap per-tile lerp/slerp between whichever two are
 *    currently adjacent, not a geometry rebuild.
 * 2. The "coming apart" effect is a continuous field, not a discrete
 *    trigger: a slow, low-frequency 3D simplex noise sampled over each
 *    tile's own fixed (along-the-loop, around-the-tube) coordinates --
 *    low frequency on purpose, so whole neighborhoods of tiles rise and
 *    fall together instead of individual sparkle -- crossed against a
 *    threshold that *scroll velocity* pushes down (the faster you
 *    scroll, the more of the surface "un-thresholds" and lifts, like
 *    disturbing something molten by moving through the room). Mouse
 *    position adds a second, independent bump on top: the canvas itself
 *    stays `pointer-events: none` (so it can never fight real page
 *    content for clicks), and hover is tracked via a window-level
 *    pointermove listener + the exact same raycast-in-local-space
 *    technique the interactive preview uses, just without the canvas
 *    needing to own the pointer at all.
 * 3. The camera swings from side to side room by room (see
 *    CAMERA_KEYFRAMES) so the object and the page's own text content
 *    are never fighting for the same screen space -- home.tsx's
 *    sections each keep their text column to whichever side the camera
 *    isn't currently favoring.
 */

const STATIONS = 130;
const TILES_AROUND = 20;
const TUBE_RADIUS = 0.34;
const TILE_GAP_FRACTION = 0.86;
const TILE_THICKNESS = 0.03;

const GROWTH_DURATION_S = 2.6;
const POP_TENSION = 260;
const POP_FRICTION = 13;

// How quickly `shapeJourney`/the camera/the scroll-linked spin catch up
// to their real scroll-driven targets -- a few frames of physical lag,
// same "everything settles like something physical" language as the
// rest of this site's springs, just exponentially smoothed here instead
// of react-spring-driven (this loop is plain requestAnimationFrame, not
// React state).
const PROGRESS_RESPONSIVENESS = 5; // per second

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
// Alternates sides room by room so the object and each section's text
// column never contest the same screen space -- positive x swings the
// object right (text sits left), negative x swings it left (text sits
// right). Hero/About/Skills below key their own text alignment off
// these same beats.
const CAMERA_KEYFRAMES: CameraKeyframe[] = [
  { p: 0.0, pos: [2.3, 0.7, 6.1], fov: 40 }, // Hero: object right, text left
  { p: 0.16, pos: [-2.5, 0.2, 7.0], fov: 39 }, // About: object left, text right
  { p: 0.38, pos: [0.4, 1.1, 9.6], fov: 36 }, // Timeline room: pulled back, roomier framing
  { p: 0.62, pos: [0.4, -0.5, 9.6], fov: 36 }, // Timeline room, later
  { p: 0.82, pos: [2.4, 0.35, 7.1], fov: 38 }, // Skills: object right, text left
  { p: 1.0, pos: [0, 0.1, 9.3], fov: 36 }, // resolved, calm, centered
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

// The organic "coming apart" field. Frequencies are deliberately LOW --
// a handful of cycles across the whole loop/circumference -- so
// neighboring tiles share close noise values and whole neighborhoods
// move together, which is what actually reads as "large sections
// coming apart" instead of fine sparkle (that was the specific
// complaint about the old version, a narrow band sweeping the loop on a
// timer).
const NOISE_FREQ_ALONG = 3.2;
const NOISE_FREQ_RING = 2.4;
const NOISE_DRIFT_SPEED = 0.16; // how fast the field itself churns, independent of scroll/hover
const REST_THRESHOLD = 0.72; // noise value a tile needs to clear to lift, at rest
const AGITATED_THRESHOLD = 0.28; // ...and at max scroll-driven agitation -- lower = more of the surface qualifies
const THRESHOLD_BAND = 0.16; // smoothstep width around the live threshold, softens the on/off edge
const MAX_LIFT = 0.52; // bigger than the old hover-only MAX_LIFT (0.36) -- this reads as bigger sections breaking loose, not a subtle bump
const ACTIVATION_CHAOS_ROTATION = 0.4; // rad, max per-tile wobble at full activation

// Scroll velocity -> agitation: a peak-hold-with-decay envelope, same
// technique this codebase already uses for the drag/momentum systems
// (see LoadingScreen3D.tsx/InfinityTrack3D.tsx's own PEAK_HOLD
// comments) -- jumps up instantly to match a fast scroll, decays slowly
// otherwise, so a quick flick of the wheel still reads as a real
// disturbance even a few frames later, not just an instantaneous blip.
const AGITATION_VELOCITY_GAIN = 14; // progress-units/sec -> agitation, roughly
const AGITATION_DECAY_HALF_LIFE_S = 0.5;

// Mouse hover: tracked globally (window pointermove), raycast against
// the tiles every frame -- the canvas itself stays pointer-events:none
// the whole time (see this file's own top comment), so this never
// competes with real page content for clicks. Radius is much larger
// than the old interactive preview's own HOVER_RADIUS (0.95): "less
// localized" was explicit feedback, and a wide, soft falloff reads as
// pushing a whole region rather than a small hot spot.
const HOVER_RADIUS = 1.55;
const HOVER_LIFT = 0.4;

// The molten color read: activation doesn't just lift a tile, it tints
// it hot via THREE.InstancedMesh's own per-instance color buffer
// (multiplies the shared material color, so values pushed past 1 with
// ACES tone mapping active read as genuinely glowing, not just
// "lighter"). Neutral (1,1,1) at rest -- a true no-op multiply -- so
// resting tiles look exactly like the material's own base color.
const HOT_TINT = new THREE.Color(3.2, 1.7, 0.55);

interface CameraKeyframeState {
  x: number;
  y: number;
  z: number;
  fov: number;
}

const GLOW_POINT_COUNT = 260;
const GLOW_POINT_SIZE = TUBE_RADIUS * 3.2;
const GLOW_WAVE_COUNT = 14;
const GLOW_SCROLL_SPEED = 0.35;

// The palette blend: warm chalk-gold ("teacher") toward a cooler
// Gruvbox aqua/blue ("resolved"), sampled across however many shapes
// are in TRACK_SHAPES (not just the two endpoints), so the middle
// "terminal" shape reads as a real midpoint, not an early jump.
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

/** Smoothstep, not a hard cutoff -- a live noise-vs-threshold comparison with a sharp edge would flicker tile-by-tile as the field drifts; this gives every tile a soft on-ramp instead. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function Experience3D({ progressRef, onBootComplete }: { progressRef: RefObject<number>; onBootComplete?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const onBootCompleteRef = useRef(onBootComplete);
  onBootCompleteRef.current = onBootComplete;

  // Global pointer tracking -- deliberately NOT attached to the canvas
  // (which stays pointer-events:none throughout, see this file's own
  // top comment). A plain module-scope-ish ref pair updated on every
  // real pointermove anywhere on the page; tick() below reads the
  // latest value each frame rather than reacting to the event itself.
  const pointerRef = useRef({ x: -9999, y: -9999 });
  useEffect(() => {
    function onMove(e: PointerEvent) {
      pointerRef.current.x = e.clientX;
      pointerRef.current.y = e.clientY;
    }
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(2.3, 0.7, 6.1);
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

    const set = buildTrackGeometrySet(TRACK_SHAPES, STATIONS, TILES_AROUND, TUBE_RADIUS);
    const tileCount = set.tileCount;
    const shapeCount = TRACK_SHAPES.length;

    const tileGeometry = new THREE.BoxGeometry(
      set.tileWidth * TILE_GAP_FRACTION,
      set.tileHeight * TILE_GAP_FRACTION,
      TILE_THICKNESS,
    );
    const tileMaterial = new THREE.MeshStandardMaterial({
      color: TILE_COLOR_TEACHER.clone(),
      metalness: 1,
      roughness: 0.2,
      envMapIntensity: 1.25,
      vertexColors: true,
    });
    const tileMesh = new THREE.InstancedMesh(tileGeometry, tileMaterial, tileCount);
    tileMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Allocates the per-instance color buffer, neutral (white, a true
    // no-op multiply against the material's own color) until the
    // activation field pushes individual tiles hot.
    for (let i = 0; i < tileCount; i++) tileMesh.setColorAt(i, new THREE.Color(1, 1, 1));
    tileMesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);

    const trackRoot = new THREE.Group();
    trackRoot.add(tileMesh);
    scene.add(trackRoot);

    // The glow strand, same technique as the preview (soft additive
    // points on the curve's own centerline) but sampled from *every*
    // shape so it blends right along with the tiles.
    const glowPositionsByShape: Float32Array[] = [];
    const glowAlong = new Float32Array(GLOW_POINT_COUNT);
    const glowLive = new Float32Array(GLOW_POINT_COUNT * 3);
    const glowColors = new Float32Array(GLOW_POINT_COUNT * 3);
    const glowVec = new THREE.Vector3();
    for (const shape of TRACK_SHAPES) {
      const arr = new Float32Array(GLOW_POINT_COUNT * 3);
      for (let i = 0; i < GLOW_POINT_COUNT; i++) {
        const t = (i / GLOW_POINT_COUNT) * Math.PI * 2;
        curvePoint(shape, t, glowVec);
        arr[i * 3] = glowVec.x;
        arr[i * 3 + 1] = glowVec.y;
        arr[i * 3 + 2] = glowVec.z;
      }
      glowPositionsByShape.push(arr);
    }
    for (let i = 0; i < GLOW_POINT_COUNT; i++) glowAlong[i] = i / GLOW_POINT_COUNT;

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
    const glowBaseNow = new THREE.Color();
    const instanceColorScratch = new THREE.Color();

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
    const chaosAxis = new THREE.Vector3();
    const chaosQuat = new THREE.Quaternion();
    const quatScratch = [0, 0, 0, 1];
    const simplex = new SimplexNoise();

    function paintTile(i: number, growScale: number, lift: number, i0: number, i1: number, frac: number, chaosJitter: number) {
      const i3 = i * 3;
      const i4 = i * 4;
      const a = set.positions[i0];
      const b = set.positions[i1];
      const px = a[i3] + (b[i3] - a[i3]) * frac;
      const py = a[i3 + 1] + (b[i3 + 1] - a[i3 + 1]) * frac;
      const pz = a[i3 + 2] + (b[i3 + 2] - a[i3 + 2]) * frac;

      const oa = set.outwards[i0];
      const ob = set.outwards[i1];
      let ox = oa[i3] + (ob[i3] - oa[i3]) * frac;
      let oy = oa[i3 + 1] + (ob[i3 + 1] - oa[i3 + 1]) * frac;
      let oz = oa[i3 + 2] + (ob[i3 + 2] - oa[i3 + 2]) * frac;
      const olen = Math.hypot(ox, oy, oz) || 1;
      ox /= olen;
      oy /= olen;
      oz /= olen;

      dummy.position.set(px + ox * lift, py + oy * lift, pz + oz * lift);

      // slerpFlat's own types insist on number[], but its implementation
      // only ever does indexed reads -- a Float32Array satisfies that
      // identically at runtime, and casting here avoids either widening
      // these arrays to real arrays (2600 tiles * 4 floats, times 3
      // shapes) or copying out of them on every tile, every frame.
      THREE.Quaternion.slerpFlat(quatScratch, 0, set.quats[i0] as unknown as number[], i4, set.quats[i1] as unknown as number[], i4, frac);
      if (chaosJitter > 0) {
        chaosAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        chaosQuat.setFromAxisAngle(chaosAxis, (Math.random() - 0.5) * 2 * chaosJitter * ACTIVATION_CHAOS_ROTATION);
        dummy.quaternion.set(quatScratch[0], quatScratch[1], quatScratch[2], quatScratch[3]).multiply(chaosQuat);
      } else {
        dummy.quaternion.set(quatScratch[0], quatScratch[1], quatScratch[2], quatScratch[3]);
      }
      dummy.scale.setScalar(growScale);
      dummy.updateMatrix();
      tileMesh.setMatrixAt(i, dummy.matrix);
    }

    const eulerScratch = new THREE.Euler();

    function disposeAll() {
      if (!container) return;
      resizeObserver.disconnect();
      renderer.dispose();
      tileGeometry.dispose();
      tileMaterial.dispose();
      glowGeometry.dispose();
      glowMaterial.dispose();
      glowSprite.dispose();
      pmrem.dispose();
      container.removeChild(renderer.domElement);
    }

    if (reduced) {
      // A single static, fully-grown resting frame in the "teacher"
      // shape/palette/framing -- no rAF loop at all.
      for (let i = 0; i < tileCount; i++) paintTile(i, 1, 0, 0, 0, 0, 0);
      tileMesh.instanceMatrix.needsUpdate = true;
      tileMaterial.color.copy(TILE_COLOR_TEACHER);
      const glowShape0 = glowPositionsByShape[0];
      for (let i = 0; i < GLOW_POINT_COUNT; i++) {
        glowLive[i * 3] = glowShape0[i * 3];
        glowLive[i * 3 + 1] = glowShape0[i * 3 + 1];
        glowLive[i * 3 + 2] = glowShape0[i * 3 + 2];
        glowColors[i * 3] = GLOW_COLOR_TEACHER.r;
        glowColors[i * 3 + 1] = GLOW_COLOR_TEACHER.g;
        glowColors[i * 3 + 2] = GLOW_COLOR_TEACHER.b;
      }
      glowPositionAttr.needsUpdate = true;
      glowColorAttr.needsUpdate = true;
      camera.position.set(...CAMERA_KEYFRAMES[0].pos);
      camera.fov = CAMERA_KEYFRAMES[0].fov;
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0, 0);
      resize();
      renderer.render(scene, camera);
      onBootCompleteRef.current?.();
      return disposeAll;
    }

    if (import.meta.env.DEV) {
      (window as unknown as { __experience3DReview: unknown }).__experience3DReview = {
        camera,
        trackRoot,
        getState: () => ({
          shapeJourney: lastShapeJourney,
          smoothedProgress: lastSmoothedProgress,
          agitation,
          hovering,
          bootFired,
          pointerScreen: { x: pointerRef.current.x, y: pointerRef.current.y },
          pointerNdc: { x: pointerNdc.x, y: pointerNdc.y },
        }),
      };
    }

    let raf = 0;
    let disposed = false;
    let lastElapsed = 0;
    const startTime = performance.now();
    let smoothedProgress = 0;
    let lastRawProgress = 0;
    let lastShapeJourney = 0;
    let lastSmoothedProgress = 0;
    let bootFired = false;
    let agitation = 0;
    let hovering = false;

    const cameraSample: CameraKeyframeState = { x: 0, y: 0, z: 0, fov: 42 };
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2(-9999, -9999);
    const hitPoint = new THREE.Vector3();

    function tick() {
      if (disposed || !container) return;
      const elapsed = (performance.now() - startTime) / 1000;
      const dt = Math.min(0.1, Math.max(0, elapsed - lastElapsed));
      lastElapsed = elapsed;

      const rawProgress = progressRef.current ?? 0;
      const scrollSpeed = dt > 0 ? Math.abs(rawProgress - lastRawProgress) / dt : 0;
      lastRawProgress = rawProgress;
      // Peak-hold with exponential decay -- jumps to match a fast
      // scroll instantly, decays smoothly otherwise (see this file's
      // own AGITATION_* comment).
      const decay = Math.pow(0.5, dt / AGITATION_DECAY_HALF_LIFE_S);
      agitation = Math.max(scrollSpeed * AGITATION_VELOCITY_GAIN, agitation * decay);
      agitation = Math.min(1, agitation);

      smoothedProgress += (rawProgress - smoothedProgress) * (1 - Math.exp(-PROGRESS_RESPONSIVENESS * dt));
      lastSmoothedProgress = smoothedProgress;

      const shapeJourney = smoothedProgress * (shapeCount - 1);
      lastShapeJourney = shapeJourney;
      const i0 = Math.min(shapeCount - 1, Math.max(0, Math.floor(shapeJourney)));
      const i1 = Math.min(shapeCount - 1, i0 + 1);
      const frac = i1 > i0 ? shapeJourney - i0 : 0;

      // Orientation: idle ambient spin + a much larger turn tied to
      // scroll, plus a gentle tilt that shifts a little further open by
      // the end of the journey.
      const yaw = elapsed * IDLE_YAW_SPEED + smoothedProgress * SCROLL_YAW_TURNS * Math.PI * 2;
      const tilt = BASE_TILT + Math.sin(elapsed * IDLE_TILT_SPEED) * IDLE_TILT_AMPLITUDE + smoothedProgress * SCROLL_TILT_SHIFT;
      eulerScratch.set(tilt, yaw, 0, "XYZ");
      trackRoot.quaternion.setFromEuler(eulerScratch);
      // Rotation only lands in .quaternion until the scene graph
      // updates at render time -- raycasting below needs this frame's
      // matrixWorld, not last frame's, or hover reads as intermittently
      // missing on a shape that's always at least a little in motion.
      trackRoot.updateMatrixWorld(true);

      sampleCamera(smoothedProgress, cameraSample);
      camera.position.set(cameraSample.x, cameraSample.y, cameraSample.z);
      camera.fov = cameraSample.fov;
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0, 0);
      // Same reasoning as trackRoot's own updateMatrixWorld above: the
      // camera moves every single frame here (unlike the interactive
      // preview, where it's static and only the object rotates), so its
      // matrixWorld is just as stale until render() -- confirmed
      // directly this was the actual reason hover raycasts never hit
      // anything at all, not just an occasional miss.
      camera.updateMatrixWorld(true);

      const paletteT = smoothedProgress; // 0..1 across the whole journey, independent of which two shapes are blending
      tileMaterial.color.lerpColors(TILE_COLOR_TEACHER, TILE_COLOR_CODER, paletteT);
      glowBaseNow.lerpColors(GLOW_COLOR_TEACHER, GLOW_COLOR_CODER, paletteT);

      // Hover: raycast the latest known pointer position against the
      // tiles. The canvas itself never receives pointer events (see
      // this file's own top comment) -- pointerRef is fed by a plain
      // window-level listener instead.
      //
      // InstancedMesh.raycast() early-outs against object.boundingSphere
      // before testing individual instances -- but that sphere is only
      // ever computed lazily, once, the first time raycast() runs, then
      // cached forever. Tiles are still collapsed to scale 0 around the
      // origin on that very first frame (mid-boot), so without
      // recomputing it here, every ray afterward gets tested against a
      // near-zero sphere from a shape that no longer exists -- confirmed
      // directly this was the entire reason hover never registered a
      // single hit, anywhere, ever. One frame stale (this uses whatever
      // instance matrices the previous frame's paint loop left behind)
      // is imperceptible; the actual per-instance test below still uses
      // this frame's real matrices regardless.
      tileMesh.computeBoundingSphere();
      pointerNdc.x = (pointerRef.current.x / window.innerWidth) * 2 - 1;
      pointerNdc.y = -(pointerRef.current.y / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObject(tileMesh);
      hovering = hits.length > 0;
      if (hovering) {
        hitPoint.copy(hits[0].point);
        trackRoot.worldToLocal(hitPoint);
      }

      const frontier = Math.min(1, elapsed / GROWTH_DURATION_S);
      if (!bootFired && frontier >= 1) {
        bootFired = true;
        onBootCompleteRef.current?.();
      }

      // The live activation threshold -- agitation (scroll velocity)
      // pushes it down, exposing more of the noise field as "active."
      const liveThreshold = REST_THRESHOLD + (AGITATED_THRESHOLD - REST_THRESHOLD) * agitation;

      for (let i = 0; i < tileCount; i++) {
        const along = set.along[i];
        if (poppedAt[i] < 0 && along <= frontier) poppedAt[i] = elapsed;
        const growScale = poppedAt[i] < 0 ? 0 : Math.max(0, springValue(elapsed - poppedAt[i], 0, 1, POP_TENSION, POP_FRICTION));

        const n = simplex.noise3d(along * NOISE_FREQ_ALONG, set.ringT[i] * NOISE_FREQ_RING, elapsed * NOISE_DRIFT_SPEED);
        const n01 = n * 0.5 + 0.5;
        const fieldActive = smoothstep(liveThreshold - THRESHOLD_BAND, liveThreshold + THRESHOLD_BAND, n01);

        let hoverBump = 0;
        if (hovering) {
          const i3 = i * 3;
          const a = set.positions[i0];
          const b = set.positions[i1];
          const px = a[i3] + (b[i3] - a[i3]) * frac;
          const py = a[i3 + 1] + (b[i3 + 1] - a[i3 + 1]) * frac;
          const pz = a[i3 + 2] + (b[i3 + 2] - a[i3 + 2]) * frac;
          const dist = Math.hypot(px - hitPoint.x, py - hitPoint.y, pz - hitPoint.z);
          const falloff = Math.max(0, 1 - dist / HOVER_RADIUS);
          hoverBump = falloff * falloff;
        }

        const activation = Math.min(1, fieldActive * (0.6 + 0.4 * frontier) + hoverBump);
        const lift = activation * MAX_LIFT + hoverBump * HOVER_LIFT;

        paintTile(i, growScale, lift, i0, i1, frac, activation);

        if (activation > 0.02) {
          instanceColorScratch.set(1, 1, 1).lerp(HOT_TINT, Math.min(1, activation * 1.3));
          tileMesh.setColorAt(i, instanceColorScratch);
        } else {
          tileMesh.setColorAt(i, instanceColorScratch.set(1, 1, 1));
        }
      }
      tileMesh.instanceMatrix.needsUpdate = true;
      if (tileMesh.instanceColor) tileMesh.instanceColor.needsUpdate = true;

      const glowA = glowPositionsByShape[i0];
      const glowB = glowPositionsByShape[i1];
      for (let i = 0; i < GLOW_POINT_COUNT; i++) {
        const i3 = i * 3;
        glowLive[i3] = glowA[i3] + (glowB[i3] - glowA[i3]) * frac;
        glowLive[i3 + 1] = glowA[i3 + 1] + (glowB[i3 + 1] - glowA[i3 + 1]) * frac;
        glowLive[i3 + 2] = glowA[i3 + 2] + (glowB[i3 + 2] - glowA[i3 + 2]) * frac;

        const along = glowAlong[i];
        if (along > frontier) {
          glowColors[i3] = 0;
          glowColors[i3 + 1] = 0;
          glowColors[i3 + 2] = 0;
          continue;
        }
        const wave = 0.55 + 0.45 * Math.sin(along * GLOW_WAVE_COUNT * Math.PI * 2 - elapsed * GLOW_SCROLL_SPEED * Math.PI * 2);
        const heat = 1 + agitation * 1.8;
        scratchColor.copy(glowBaseNow).multiplyScalar(wave * heat);
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
      disposeAll();
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
