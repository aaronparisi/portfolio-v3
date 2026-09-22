import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js";
import {
  buildTrackGeometry,
  buildOrbShape,
  buildScreenShape,
  buildTileUV,
  flattenTubeShape,
  SHAPE_TEACHER,
  type FlatShapeGeometry,
} from "~/three/createInfinityTrack";
import { springValue } from "~/utils/springValue";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

/**
 * The site's persistent 3D backdrop -- the same tiled light-beam
 * infinity track tuned in isolation on /infinity-preview
 * (InfinityTrack3D.tsx, left untouched), rebuilt as a fixed, full-
 * viewport layer that runs the whole way down the page. Everything here
 * is driven by scroll -- position, not time:
 *
 * 1. The shape itself morphs between three GENUINELY different
 *    arrangements (createInfinityTrack.ts) -- the chalk-era tube-swept
 *    loop, a sphere ("orb"), and a flat tile grid ("screen") -- as a
 *    function of overall scroll progress. Not three variations on one
 *    "tiles around a beam" theme: a loop, a sphere, and a plane share no
 *    common parametrization at all, only the same tile count/index
 *    order, which is all the per-tile lerp/slerp blend actually needs.
 * 2. The "coming apart" effect is a continuous field, active ONLY while
 *    actually scrolling -- low-frequency 3D simplex noise sampled over
 *    each tile's own fixed (along, around) coordinates so whole
 *    neighborhoods rise and fall together, crossed against a threshold
 *    that's unreachable at rest and drops as scroll *velocity* rises.
 *    The noise field's own "drift" and the glow strand's flowing
 *    brightness wave are both driven by an accumulated scroll distance,
 *    not elapsed time -- stop scrolling and both freeze exactly where
 *    they are, not just visually slow down. Mouse hover adds a second,
 *    independent bump on top, tracked via a window-level pointermove
 *    listener rather than the canvas itself ever receiving pointer
 *    events, so it can never compete with real page content for clicks.
 * 3. The object itself (not the camera, which stays fixed) moves to a
 *    different place on screen room by room (see ROOM_KEYFRAMES) --
 *    home.tsx's sections keep their text column wherever the object
 *    currently isn't.
 *
 * The only thing still driven by elapsed wall-clock time is the one-
 * shot boot/growth sequence on mount -- a real entrance, not ambient
 * idling, so it's exempt from "still unless scrolling."
 */

const STATIONS = 130;
const TILES_AROUND = 20;
const TUBE_RADIUS = 0.34;
const TILE_GAP_FRACTION = 0.86;
const TILE_THICKNESS = 0.03;
const ORB_RADIUS = 2.1;
const SCREEN_COLS = 65; // 130*20 / 65 = 40 rows exactly, no partial row
const SCREEN_SPACING = 0.085;

const GROWTH_DURATION_S = 2.6;
const POP_TENSION = 260;
const POP_FRICTION = 13;

// How quickly `shapeJourney`/the room transform/the scroll-linked spin
// catch up to their real scroll-driven targets -- a few frames of
// physical lag, same "everything settles like something physical"
// language as the rest of this site's springs, just exponentially
// smoothed here instead of react-spring-driven (this loop is plain
// requestAnimationFrame, not React state). This is the only smoothing
// left that can make the object move a beat after scroll has already
// stopped -- a brief physical settle, not perpetual idling.
const PROGRESS_RESPONSIVENESS = 5; // per second

const SCROLL_YAW_TURNS = 1.35; // full turns across progress 0..1 -- purely scroll-driven, no idle component
const BASE_TILT = 0.18; // rad, a gentle constant 3/4 angle rather than dead-on
const SCROLL_TILT_SHIFT = 0.22; // rad, added tilt by the end of the journey

interface RoomKeyframe {
  p: number;
  pos: [number, number, number];
  scale: number;
}
// Where the object sits on screen, room by room -- the camera itself
// stays fixed (see its own setup below); this is what actually moves.
// Deliberately varied beyond just "left vs. right": top, bottom, a
// lower corner, center -- "move to different places on the screen; it
// shouldn't always be centered behind everything" was explicit
// feedback. Hero/About/Skills key their own text alignment off these
// same beats (see each component's own comment).
const ROOM_KEYFRAMES: RoomKeyframe[] = [
  { p: 0.0, pos: [2.7, 0.3, 0], scale: 1.05 }, // Hero: right, big
  { p: 0.16, pos: [-2.9, -0.2, -0.5], scale: 0.85 }, // About: left
  { p: 0.36, pos: [0, 2.3, -2], scale: 0.55 }, // Timeline room: pushed up top, small, out of the cards' way
  { p: 0.62, pos: [0, -2.3, -2], scale: 0.55 }, // Timeline room: drifts to the bottom by the room's end
  { p: 0.82, pos: [2.6, -1.6, -0.3], scale: 0.85 }, // Skills: right, lower corner
  { p: 1.0, pos: [0, 0, -3], scale: 0.5 }, // resolved: center, small, receding into the fade-out
];

function sampleRoom(p: number, out: { x: number; y: number; z: number; scale: number }) {
  let lo = ROOM_KEYFRAMES[0];
  let hi = ROOM_KEYFRAMES[ROOM_KEYFRAMES.length - 1];
  for (let i = 0; i < ROOM_KEYFRAMES.length - 1; i++) {
    if (p >= ROOM_KEYFRAMES[i].p && p <= ROOM_KEYFRAMES[i + 1].p) {
      lo = ROOM_KEYFRAMES[i];
      hi = ROOM_KEYFRAMES[i + 1];
      break;
    }
  }
  const span = hi.p - lo.p;
  const t = span > 0 ? (p - lo.p) / span : 0;
  out.x = lo.pos[0] + (hi.pos[0] - lo.pos[0]) * t;
  out.y = lo.pos[1] + (hi.pos[1] - lo.pos[1]) * t;
  out.z = lo.pos[2] + (hi.pos[2] - lo.pos[2]) * t;
  out.scale = lo.scale + (hi.scale - lo.scale) * t;
}

// The organic "coming apart" field. Frequencies are deliberately LOW --
// a handful of cycles across the whole tile index range -- so
// neighboring tiles share close noise values and whole neighborhoods
// move together, reading as "large sections coming apart" instead of
// fine sparkle.
const NOISE_FREQ_ALONG = 3.2;
const NOISE_FREQ_RING = 2.4;
// The field's own drift is driven by accumulated scroll DISTANCE, not
// elapsed time (see `scrollOdometer` in tick()) -- explicit feedback
// was that the surface read as "alive" on its own; multiplied against
// odometer (which only advances while actually scrolling) this freezes
// completely at rest instead of just slowing down.
const NOISE_DRIFT_SPEED = 6;
// REST_THRESHOLD sits above 1 (noise01's own max) on purpose -- the
// smoothstep band below it can never be crossed at agitation 0, so
// exactly zero ambient activation at rest, not just "rare." Only
// AGITATED_THRESHOLD (reached while actively, briskly scrolling) sits
// in reachable territory.
const REST_THRESHOLD = 1.3;
const AGITATED_THRESHOLD = 0.28;
const THRESHOLD_BAND = 0.16; // smoothstep width around the live threshold, softens the on/off edge
const MAX_LIFT = 0.52;
const ACTIVATION_CHAOS_ROTATION = 0.4; // rad, max per-tile wobble at full activation

// Scroll velocity -> agitation: a peak-hold-with-decay envelope, same
// technique this codebase's own drag/momentum systems already use --
// jumps up instantly to match a fast scroll, decays over half a second
// otherwise, so the surface's own reaction outlasts a single scroll
// event by a beat rather than flickering with it, while still reading
// as "still" within a second or so of the scrolling actually stopping.
// The gain is tuned to respond to ordinary wheel/trackpad scrolling,
// not just an aggressive flick -- verified directly against a simulated
// moderate scroll, not just a synthetic burst.
const AGITATION_VELOCITY_GAIN = 45;
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

const GLOW_POINT_COUNT = 260;
const GLOW_INDEX_STRIDE = (STATIONS * TILES_AROUND) / GLOW_POINT_COUNT; // 10, exact -- every 10th tile's own position/along feeds the glow strand
const GLOW_POINT_SIZE = TUBE_RADIUS * 3.2;
const GLOW_WAVE_COUNT = 14;
// Same reasoning as NOISE_DRIFT_SPEED -- driven by accumulated scroll
// distance, not elapsed time, so the "energy flowing" wave freezes at
// rest instead of perpetually animating.
const GLOW_SCROLL_SPEED = 2.5;

// The palette blend: warm chalk-gold ("teacher") toward a cooler
// resolved blue, across the whole journey regardless of which two
// shapes are currently blending.
const TILE_COLOR_TEACHER = new THREE.Color(0x2b2622);
const TILE_COLOR_CODER = new THREE.Color(0x22262f);
const GLOW_COLOR_TEACHER = new THREE.Color(0xf0b23c);
const GLOW_COLOR_CODER = new THREE.Color(0x6d8cff);

// The shape morph finishes by this fraction of the whole scroll, not at
// 1 -- see shapeJourney's own comment in tick() for why.
const SHAPE_MORPH_END = 0.75;

// The fade-out: over the last stretch of progress, the whole layer
// eases its opacity to 0 so Footer reads as a clean, deliberate stop
// rather than fighting a giant WebGL canvas for attention. Starts well
// after SHAPE_MORPH_END, leaving a real settled window in between.
const FADE_START = 0.92;

// The camera never moves -- everything about "where does it appear on
// screen" is the object's own position/scale instead (ROOM_KEYFRAMES
// above). A fixed camera also means its matrixWorld only ever needs
// updating once, at setup, rather than every frame the way a moving
// camera would (see this file's own commit history on why a moving
// camera's stale matrixWorld silently broke hover raycasting before).
const CAMERA_POS: [number, number, number] = [0, 0.3, 8.5];
const CAMERA_FOV = 40;

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
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
    camera.position.set(...CAMERA_POS);
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

    // Three genuinely different shapes -- see this file's own top
    // comment. `along`/`ringT` come from the tube topology alone
    // (buildTileUV) and are reused as every shape's noise-field domain,
    // regardless of which one is actually on screen -- see
    // buildTileUV's own comment for why that's deliberate.
    const tubeInfo = buildTrackGeometry(SHAPE_TEACHER, STATIONS, TILES_AROUND, TUBE_RADIUS);
    const teacherGeom: FlatShapeGeometry = flattenTubeShape(tubeInfo);
    const orbGeom = buildOrbShape(STATIONS * TILES_AROUND, ORB_RADIUS);
    const screenGeom = buildScreenShape(STATIONS * TILES_AROUND, SCREEN_COLS, SCREEN_SPACING);
    const shapes = [teacherGeom, orbGeom, screenGeom];
    const shapeCount = shapes.length;
    const positions = shapes.map((s) => s.positions);
    const outwards = shapes.map((s) => s.outwards);
    const quats = shapes.map((s) => s.quats);
    const { along, ringT } = buildTileUV(STATIONS, TILES_AROUND);
    const tileCount = along.length;

    // An average tile footprint across all three shapes, from the
    // tube's own real proportions -- one shared, unchanging box
    // geometry, not something that resizes as the shape blends.
    const tileGeometry = new THREE.BoxGeometry(
      tubeInfo.tileWidth * TILE_GAP_FRACTION,
      tubeInfo.tileHeight * TILE_GAP_FRACTION,
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

    // The glow strand: every GLOW_INDEX_STRIDE'th tile's own position
    // (and `along`) feeds it directly -- same underlying arrays the
    // tiles themselves use, at a stride, rather than a second,
    // independent curve-sampling system per shape (which orb/screen
    // don't have a natural one for anyway).
    const glowAlong = new Float32Array(GLOW_POINT_COUNT);
    const glowLive = new Float32Array(GLOW_POINT_COUNT * 3);
    const glowColors = new Float32Array(GLOW_POINT_COUNT * 3);
    for (let k = 0; k < GLOW_POINT_COUNT; k++) glowAlong[k] = along[k * GLOW_INDEX_STRIDE];

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
      const a = positions[i0];
      const b = positions[i1];
      const px = a[i3] + (b[i3] - a[i3]) * frac;
      const py = a[i3 + 1] + (b[i3 + 1] - a[i3 + 1]) * frac;
      const pz = a[i3 + 2] + (b[i3 + 2] - a[i3 + 2]) * frac;

      const oa = outwards[i0];
      const ob = outwards[i1];
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
      THREE.Quaternion.slerpFlat(quatScratch, 0, quats[i0] as unknown as number[], i4, quats[i1] as unknown as number[], i4, frac);
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
    const roomSample = { x: 0, y: 0, z: 0, scale: 1 };

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
      // shape/palette, Hero's own room position -- no rAF loop at all.
      for (let i = 0; i < tileCount; i++) paintTile(i, 1, 0, 0, 0, 0, 0);
      tileMesh.instanceMatrix.needsUpdate = true;
      tileMaterial.color.copy(TILE_COLOR_TEACHER);
      for (let k = 0; k < GLOW_POINT_COUNT; k++) {
        const srcI = k * GLOW_INDEX_STRIDE;
        glowLive[k * 3] = teacherGeom.positions[srcI * 3];
        glowLive[k * 3 + 1] = teacherGeom.positions[srcI * 3 + 1];
        glowLive[k * 3 + 2] = teacherGeom.positions[srcI * 3 + 2];
        glowColors[k * 3] = GLOW_COLOR_TEACHER.r;
        glowColors[k * 3 + 1] = GLOW_COLOR_TEACHER.g;
        glowColors[k * 3 + 2] = GLOW_COLOR_TEACHER.b;
      }
      glowPositionAttr.needsUpdate = true;
      glowColorAttr.needsUpdate = true;
      sampleRoom(0, roomSample);
      trackRoot.position.set(roomSample.x, roomSample.y, roomSample.z);
      trackRoot.scale.setScalar(roomSample.scale);
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
          scrollOdometer,
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
    let scrollOdometer = 0;
    let hovering = false;

    // Camera never moves after this -- see CAMERA_POS's own comment.
    camera.updateMatrixWorld(true);

    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2(-9999, -9999);
    const hitPoint = new THREE.Vector3();

    function tick() {
      if (disposed || !container) return;
      const elapsed = (performance.now() - startTime) / 1000;
      const dt = Math.min(0.1, Math.max(0, elapsed - lastElapsed));
      lastElapsed = elapsed;

      const rawProgress = progressRef.current ?? 0;
      const rawDelta = rawProgress - lastRawProgress;
      const scrollSpeed = dt > 0 ? Math.abs(rawDelta) / dt : 0;
      scrollOdometer += Math.abs(rawDelta);
      lastRawProgress = rawProgress;
      // Peak-hold with exponential decay -- jumps to match a fast
      // scroll instantly, decays smoothly otherwise (see this file's
      // own AGITATION_* comment).
      const decay = Math.pow(0.5, dt / AGITATION_DECAY_HALF_LIFE_S);
      agitation = Math.max(scrollSpeed * AGITATION_VELOCITY_GAIN, agitation * decay);
      agitation = Math.min(1, agitation);

      smoothedProgress += (rawProgress - smoothedProgress) * (1 - Math.exp(-PROGRESS_RESPONSIVENESS * dt));
      lastSmoothedProgress = smoothedProgress;

      // Compressed into the first SHAPE_MORPH_END of the scroll, not the
      // whole thing -- mapping shapeJourney straight off smoothedProgress
      // 0..1 meant the final shape only ever finished forming exactly at
      // progress 1, the same moment FADE_START has already made the
      // whole layer nearly invisible (confirmed directly: the resolved
      // "screen" shape was never actually visible at full opacity,
      // anywhere). This leaves a real settled window -- SHAPE_MORPH_END
      // to FADE_START -- where the final shape is fully formed and still
      // fully opaque before it fades.
      const shapeJourney = Math.min(shapeCount - 1, (smoothedProgress / SHAPE_MORPH_END) * (shapeCount - 1));
      lastShapeJourney = shapeJourney;
      const i0 = Math.min(shapeCount - 1, Math.max(0, Math.floor(shapeJourney)));
      const i1 = Math.min(shapeCount - 1, i0 + 1);
      const frac = i1 > i0 ? shapeJourney - i0 : 0;

      // Orientation and position/scale: both purely a function of
      // smoothedProgress now -- no elapsed-time-driven idle spin/tilt at
      // all (that was the actual mechanism behind the surface reading as
      // "alive" even at rest).
      const yaw = smoothedProgress * SCROLL_YAW_TURNS * Math.PI * 2;
      const tilt = BASE_TILT + smoothedProgress * SCROLL_TILT_SHIFT;
      eulerScratch.set(tilt, yaw, 0, "XYZ");
      trackRoot.quaternion.setFromEuler(eulerScratch);
      sampleRoom(smoothedProgress, roomSample);
      trackRoot.position.set(roomSample.x, roomSample.y, roomSample.z);
      trackRoot.scale.setScalar(roomSample.scale);
      // Rotation/position/scale only land in their own properties until
      // the scene graph updates at render time -- raycasting below needs
      // this frame's matrixWorld, not last frame's, or hover reads as
      // intermittently missing on a shape that's always at least a
      // little in motion.
      trackRoot.updateMatrixWorld(true);

      // Same SHAPE_MORPH_END compression as shapeJourney -- the palette
      // should finish resolving right alongside the shape, not keep
      // drifting warm-to-cool for the rest of the scroll after the shape
      // itself has already settled into its final form.
      const paletteT = Math.min(1, smoothedProgress / SHAPE_MORPH_END);
      tileMaterial.color.lerpColors(TILE_COLOR_TEACHER, TILE_COLOR_CODER, paletteT);
      glowBaseNow.lerpColors(GLOW_COLOR_TEACHER, GLOW_COLOR_CODER, paletteT);
      // Sprite size doesn't auto-scale with the parent group's own scale
      // (only vertex *positions* do) -- without this the glow would stay
      // full-size even when the whole object shrinks into a smaller room.
      glowMaterial.size = GLOW_POINT_SIZE * roomSample.scale;

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
      // near-zero sphere from a shape that no longer exists.
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
      // pushes it down from an unreachable resting value, exposing more
      // of the noise field as "active" the faster you scroll.
      const liveThreshold = REST_THRESHOLD + (AGITATED_THRESHOLD - REST_THRESHOLD) * agitation;
      const noiseZ = scrollOdometer * NOISE_DRIFT_SPEED;

      for (let i = 0; i < tileCount; i++) {
        const tileAlong = along[i];
        if (poppedAt[i] < 0 && tileAlong <= frontier) poppedAt[i] = elapsed;
        const growScale = poppedAt[i] < 0 ? 0 : Math.max(0, springValue(elapsed - poppedAt[i], 0, 1, POP_TENSION, POP_FRICTION));

        const n = simplex.noise3d(tileAlong * NOISE_FREQ_ALONG, ringT[i] * NOISE_FREQ_RING, noiseZ);
        const n01 = n * 0.5 + 0.5;
        const fieldActive = smoothstep(liveThreshold - THRESHOLD_BAND, liveThreshold + THRESHOLD_BAND, n01);

        let hoverBump = 0;
        if (hovering) {
          const i3 = i * 3;
          const a = positions[i0];
          const b = positions[i1];
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

      const glowPosA = positions[i0];
      const glowPosB = positions[i1];
      for (let k = 0; k < GLOW_POINT_COUNT; k++) {
        const srcI3 = k * GLOW_INDEX_STRIDE * 3;
        const k3 = k * 3;
        glowLive[k3] = glowPosA[srcI3] + (glowPosB[srcI3] - glowPosA[srcI3]) * frac;
        glowLive[k3 + 1] = glowPosA[srcI3 + 1] + (glowPosB[srcI3 + 1] - glowPosA[srcI3 + 1]) * frac;
        glowLive[k3 + 2] = glowPosA[srcI3 + 2] + (glowPosB[srcI3 + 2] - glowPosA[srcI3 + 2]) * frac;

        const pointAlong = glowAlong[k];
        if (pointAlong > frontier) {
          glowColors[k3] = 0;
          glowColors[k3 + 1] = 0;
          glowColors[k3 + 2] = 0;
          continue;
        }
        const wave = 0.55 + 0.45 * Math.sin(pointAlong * GLOW_WAVE_COUNT * Math.PI * 2 - scrollOdometer * GLOW_SCROLL_SPEED * Math.PI * 2);
        const heat = 1 + agitation * 1.8;
        scratchColor.copy(glowBaseNow).multiplyScalar(wave * heat);
        glowColors[k3] = scratchColor.r;
        glowColors[k3 + 1] = scratchColor.g;
        glowColors[k3 + 2] = scratchColor.b;
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
