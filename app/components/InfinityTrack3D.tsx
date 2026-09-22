import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildTrackGeometry, curvePoint, SHAPE_TEACHER, type TileInstance } from "~/three/createInfinityTrack";

// This preview is tuned against a single fixed shape -- SHAPE_TEACHER
// is exactly the curveA=2.2/curveC=0.9/no-twist values this file used
// to hard-code itself, before createInfinityTrack.ts generalized to
// support the site's own multi-shape morph (see Experience3D.tsx).
const SHAPE = SHAPE_TEACHER;
import { springValue } from "~/utils/springValue";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

// Solved, not eyeballed: at the previous 103/9, tileWidth (along the
// track's length) and tileHeight (around its circumference) were
// 0.137 and 0.237 -- a 0.58 aspect ratio, visibly rectangular. 130/20
// brings that to a near-exact 1:1 square while landing on a notably
// higher total (2600 vs. 927) rather than just barely more.
const STATIONS = 130;
const TILES_AROUND = 20;
const TUBE_RADIUS = 0.34;

const TILE_GAP_FRACTION = 0.86; // tiles fill this much of their allotted space, leaving a visible seam
const TILE_THICKNESS = 0.03; // scaled down along with the smaller tiles, to keep the same visual proportions

// Growth entrance: the track lays itself down tile-ring by tile-ring
// around the loop, each ring popping into place with a springy
// overshoot right as the growth frontier reaches it, rather than
// everything fading in or scaling up together.
const GROWTH_DURATION_S = 2.6;
const POP_WINDOW_S = 0.5; // how long one ring's own pop-in spring plays
const POP_TENSION = 260;
const POP_FRICTION = 13;

// Hover: tiles within HOVER_RADIUS of the cursor's 3D hit point lift
// outward, falloff-weighted by distance -- "breaking through" a patch
// of the surface, not a single tile popping alone.
const HOVER_RADIUS = 0.95;
const MAX_LIFT = 0.36;
const LIFT_RESPONSIVENESS = 10; // per second, exponential smoothing rate

// The exact drag/momentum system LoadingScreen3D.tsx worked out (see
// its own extensive comments on each of these) -- ported wholesale
// rather than re-derived, since this component's first pass reinvented
// a much simpler direct-drag-only version and got back every bug that
// system was built specifically to fix (freezing for a few hundred ms
// after a macOS three-finger-drag release, a flick's speed collapsing
// to nothing if the hand paused even briefly before lifting).
const DRAG_SENSITIVITY = 0.008;
const BASELINE_SPEED_PX = 22.5;
const MAX_FLICK_SPEED_PX = 900;
const MIN_FLICK_SPEED_PX = 4;
const MOMENTUM_TENSION = 4;
const MOMENTUM_FRICTION = 4;
const PEAK_HOLD_HALF_LIFE_MS = 180;
const STALE_TIMEOUT_MS = 50;

// The full Gruvbox bright palette, in hue order -- same array used for
// the loading button's own rainbow effects (EnterSiteButton.tsx),
// reused here for visual consistency across the site's two hand-built
// color effects rather than picking a second, slightly different set.
const GRUVBOX_HUES = ["#fb4934", "#fe8019", "#fabd2f", "#b8bb26", "#8ec07c", "#83a598", "#d3869b"];

// Temporarily off: both the periodic Gruvbox color sweep and the tile
// blowout wave it drives are disabled while the glow strand's own look
// is being tuned, so the two aren't fighting for attention on screen
// at once. Flip back on later -- none of the scheduling/logic below
// was removed, just gated.
const PULSE_ENABLED = false;

// The Gruvbox pulse: a band of the full palette sweeps once around the
// entire loop every so often, then disappears until the next one --
// "from time to time," not a constant loop. A little randomness on the
// interval (see nextPulseAt below) keeps it from feeling metronomic.
const PULSE_INTERVAL_S = 6;
const PULSE_INTERVAL_JITTER_S = 2;
const PULSE_DURATION_S = 2.2; // time for the band to complete one full lap

// The pulse doesn't just recolor the glow strand -- it also blows a
// traveling wave of tiles outward as it passes, bigger and rougher
// than the smooth, controlled hover lift. PULSE_TILE_WINDOW is how
// wide a slice of the loop (in the same 0..1 `along` units as the
// pulse's own position) is "currently blowing out" at any instant;
// PULSE_TILE_LIFT is deliberately well past hover's own MAX_LIFT, and
// PULSE_CHAOS_ROTATION adds a fast, re-rolled-every-frame rotational
// wobble on top of the lift -- a smooth, uniform wave reads as
// mechanical, and this needed to read as something closer to breaking
// apart.
const PULSE_TILE_WINDOW = 0.04;
const PULSE_TILE_LIFT = 0.65;
const PULSE_CHAOS_ROTATION = 0.6; // radians, max random wobble
// How much of the loop (in the same 0..1 `along` units) the pulse's
// own rainbow gradient spans on the glow strand -- wider than the tile
// blowout's own window, since the color band reads better with some
// visible spread across the palette rather than a tight sliver.
const PULSE_GLOW_WINDOW = 0.09;

// The glow: no tube geometry at all now -- a tube has real volume and
// a rounded cross-section, and looked like exactly that regardless of
// what texture rode on its surface (confirmed directly: it read as a
// lit PVC pipe, not light). This is instead a string of camera-facing,
// additively-blended sprites sitting right on the curve's own
// centerline (see createGlowSprite() and the Points object below) --
// the standard technique for "light with no mass," since a sprite has
// no silhouette of its own to read as a solid surface, only a soft
// glow that gets brighter wherever sprites overlap.
const GLOW_POINT_COUNT = 260;
// Sized directly against TUBE_RADIUS (the tiles' own distance from the
// centerline) rather than picked in isolation: at the old 0.5 (radius
// 0.25, well inside TUBE_RADIUS's 0.34) the glow read as a thin beam
// sitting deep inside a hollow shell. This puts the sprite's own soft
// edge well past the tiles' inner surface, so the light reads as
// filling the tube's whole cross-section -- tiles floating right on
// top of it -- rather than something glimpsed through a gap behind them.
const GLOW_POINT_SIZE = TUBE_RADIUS * 3.2;
const GLOW_BASE_COLOR = new THREE.Color(0xfabd2f);
// The "energy flowing" brightness wave along the strand -- how many
// full bright/dim cycles fit around the whole loop, and how fast that
// pattern travels.
const GLOW_WAVE_COUNT = 14;
const GLOW_SCROLL_SPEED = 0.35; // cycles per second

/**
 * One soft white radial blob -- tinted per-point via vertex colors
 * (see the Points material below) rather than baking any actual color
 * into the sprite itself, so the same texture serves both the resting
 * gold glow and the traveling Gruvbox pulse. White multiplied by a
 * color is just that color; there's no reason to draw the gradient
 * twice.
 */
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

// Precomputed once -- THREE.Color instances, not hex strings, so
// gruvboxColorAt() below can lerp between adjacent stops directly
// instead of parsing a string every call (every point, every frame the
// pulse is active).
const GRUVBOX_COLORS = GRUVBOX_HUES.map((hex) => new THREE.Color(hex));

/** Samples the Gruvbox palette as a continuous gradient at t in [0, 1], lerping between its two nearest stops. */
function gruvboxColorAt(t: number, out: THREE.Color): THREE.Color {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (GRUVBOX_COLORS.length - 1);
  const i0 = Math.floor(scaled);
  const i1 = Math.min(GRUVBOX_COLORS.length - 1, i0 + 1);
  return out.copy(GRUVBOX_COLORS[i0]).lerp(GRUVBOX_COLORS[i1], scaled - i0);
}

/**
 * The site's new hero centerpiece: an infinity symbol that's actually a
 * closed 3D "racetrack" (see createInfinityTrack.ts for the curve
 * math), built from small metal tiles rather than a smooth tube. Hover
 * anywhere on it and nearby tiles lift outward along their own surface
 * normal, revealing a glowing strand of light that otherwise sits
 * hidden just behind them -- "breaking through" the plating. That
 * strand is a string of soft, additively-blended sprites right on the
 * curve's own centerline, not a tube -- a tube has real volume and a
 * silhouette of its own no matter what's painted on it, which read as
 * a lit pipe rather than actual light (see createGlowSprite's own
 * comment). On mount the whole thing grows itself into existence, ring
 * by ring around the loop, each ring popping in with a small spring
 * overshoot right as the growth frontier reaches it.
 *
 * All tiles share one InstancedMesh (their base positions/orientations
 * never change, only each one's own outward lift offset and growth
 * scale do, both written into that instance's matrix every frame) --
 * at ~700 tiles for the default station/tilesAround counts, recomputing
 * every instance's matrix each frame is trivial next to actually
 * rendering them.
 */
export function InfinityTrack3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 1.4, 6.2);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);

    // A procedural environment (three's own RoomEnvironment, not an
    // external HDRI file) gives the tiles' metal material something to
    // actually reflect -- without it, a high-metalness material has
    // nothing to show but flat, near-black shading regardless of scene
    // lights, since metals render almost entirely via reflection rather
    // than diffuse light.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // One deliberate light source, not two competing ones: a single
    // strong key from the upper right (a classic 3/4 studio angle),
    // which is what actually sells "polished metal catching a light"
    // -- a clear, decisive highlight direction rather than evenly-lit
    // flatness. The cool rim behind/below is only a faint fill now, just
    // enough to keep the far side from going pure black, not a second
    // light competing for attention.
    const key = new THREE.DirectionalLight(0xfff4e0, 1.5);
    key.position.set(5, 7, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xa8c8ff, 0.25);
    rim.position.set(-5, -2, -3);
    scene.add(rim);

    const { tiles, tileWidth, tileHeight } = buildTrackGeometry(SHAPE, STATIONS, TILES_AROUND, TUBE_RADIUS);
    const tileCount = tiles.length;

    const tileGeometry = new THREE.BoxGeometry(
      tileWidth * TILE_GAP_FRACTION,
      tileHeight * TILE_GAP_FRACTION,
      TILE_THICKNESS,
    );
    const tileMaterial = new THREE.MeshStandardMaterial({
      color: 0x2b2622,
      metalness: 1,
      roughness: 0.2,
      envMapIntensity: 1.25,
    });
    const tileMesh = new THREE.InstancedMesh(tileGeometry, tileMaterial, tileCount);
    tileMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // One group for both meshes -- drag/momentum then only ever needs
    // to rotate a single object, and the raycaster's target (tileMesh)
    // automatically inherits whatever this root's current orientation
    // is through the normal scene graph, rather than the two meshes
    // needing their rotations kept in lockstep by hand.
    const trackRoot = new THREE.Group();
    trackRoot.add(tileMesh);
    scene.add(trackRoot);

    // The glow strand: GLOW_POINT_COUNT points sitting right on the
    // curve's own centerline (radius 0 -- no tube, no cross-section at
    // all), each carrying its own live-updated color. Position and
    // `along` (0..1 around the loop, same units the tile blowout/pulse
    // scheduling already use) are fixed per point at build time; color
    // is the only thing that changes, every frame, in tick() below.
    const glowPositions = new Float32Array(GLOW_POINT_COUNT * 3);
    const glowAlong = new Float32Array(GLOW_POINT_COUNT);
    const glowColors = new Float32Array(GLOW_POINT_COUNT * 3);
    const glowPointVec = new THREE.Vector3();
    for (let i = 0; i < GLOW_POINT_COUNT; i++) {
      const t = (i / GLOW_POINT_COUNT) * Math.PI * 2;
      curvePoint(SHAPE, t, glowPointVec);
      glowPositions[i * 3] = glowPointVec.x;
      glowPositions[i * 3 + 1] = glowPointVec.y;
      glowPositions[i * 3 + 2] = glowPointVec.z;
      glowAlong[i] = i / GLOW_POINT_COUNT;
    }
    const glowGeometry = new THREE.BufferGeometry();
    glowGeometry.setAttribute("position", new THREE.BufferAttribute(glowPositions, 3));
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
    const liftCurrent = new Float32Array(tileCount);
    const liftTarget = new Float32Array(tileCount);
    const poppedAt = new Float32Array(tileCount).fill(-1);
    // Each tile's own fixed share of the pulse blowout's randomness --
    // rolled once, at build time, not re-rolled per pulse, so a given
    // tile is consistently a little more or less dramatic than its
    // neighbors every time a pulse passes it, rather than the whole
    // wave looking identical (just uniformly scaled) on every pass.
    const chaosSeeds = new Float32Array(tileCount).map(() => Math.random());
    const chaosAxis = new THREE.Vector3();
    const chaosQuat = new THREE.Quaternion();

    function paintTile(i: number, tile: TileInstance, growScale: number, lift: number, chaosJitter = 0) {
      dummy.position.copy(tile.basePosition).addScaledVector(tile.outward, lift);
      if (chaosJitter > 0) {
        // A fresh random axis/angle every single frame it's active,
        // not an animated tilt eased toward a target -- a genuine
        // jittery shake reads as "chaotic"; a smoothly interpolated
        // rotation would just read as a controlled tilt, however big.
        chaosAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        chaosQuat.setFromAxisAngle(chaosAxis, (Math.random() - 0.5) * 2 * chaosJitter * PULSE_CHAOS_ROTATION);
        dummy.quaternion.copy(tile.quaternion).multiply(chaosQuat);
      } else {
        dummy.quaternion.copy(tile.quaternion);
      }
      dummy.scale.setScalar(growScale);
      dummy.updateMatrix();
      tileMesh.setMatrixAt(i, dummy.matrix);
    }

    if (reduced) {
      // No growth, no hover response, no scroll/pulse -- the finished
      // track at a steady resting glow, motionless.
      tiles.forEach((tile, i) => paintTile(i, tile, 1, 0));
      tileMesh.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < GLOW_POINT_COUNT; i++) {
        glowColors[i * 3] = GLOW_BASE_COLOR.r;
        glowColors[i * 3 + 1] = GLOW_BASE_COLOR.g;
        glowColors[i * 3 + 2] = GLOW_BASE_COLOR.b;
      }
      glowColorAttr.needsUpdate = true;
      resize();
      renderer.render(scene, camera);
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

    // Pointer tracking for the hover raycast -- world hit point, not
    // just which single tile the ray struck, since the lift falloff is
    // measured in real 3D distance from that point across every tile.
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2(2, 2); // starts off-canvas -- no hover until a real pointer event arrives
    let hovering = false;
    const hitPoint = new THREE.Vector3();
    let lastHaveHit = false; // this frame's real hit/miss -- hitPoint alone can't tell a fresh hit from a stale one carried over from an earlier frame

    // Free rotation, any axis, no poles: each drag frame composes a
    // small yaw (around world-up) and pitch (around the camera's own
    // right vector) and premultiplies it onto the track's current
    // orientation -- premultiply, not multiply, applies the new
    // rotation in world/camera space, so dragging feels the same
    // regardless of how the track has already been spun.
    const worldUp = new THREE.Vector3(0, 1, 0);
    const cameraRightVec = new THREE.Vector3();
    function rotateTrackByPixels(dx: number, dy: number) {
      cameraRightVec.setFromMatrixColumn(camera.matrixWorld, 0);
      const yawQuat = new THREE.Quaternion().setFromAxisAngle(worldUp, dx * DRAG_SENSITIVITY);
      const pitchQuat = new THREE.Quaternion().setFromAxisAngle(cameraRightVec, dy * DRAG_SENSITIVITY);
      trackRoot.quaternion.premultiply(yawQuat);
      trackRoot.quaternion.premultiply(pitchQuat);
    }

    // `dragging` tracks the OS-level gesture (from pointerdown to
    // whenever a real pointerup/pointercancel eventually fires).
    // `liveInputActive` tracks something subtly different: whether
    // we're actually still receiving fresh movement right now, which is
    // what gates live-drag vs. momentum-replay in tick() below -- see
    // STALE_TIMEOUT_MS's own comment for why these two can't just be
    // the same flag.
    let dragging = false;
    let liveInputActive = false;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let lastMoveTime = 0;

    // Speed is tracked as a "peak hold with decay" envelope, not a
    // trailing time window and not a recency-weighted exponential
    // smooth -- both break on an extremely common real gesture: a hand
    // naturally decelerating or pausing for a moment right before
    // actually lifting the mouse button. A peak-hold jumps up instantly
    // to match any new fast instant but only decays slowly otherwise,
    // so a flick's real speed survives a brief pause before release.
    let trackedSpeed = 0;
    let trackedDirX = 1;
    let trackedDirY = 0;

    // Momentum: the tracked (direction, speed) pair at release, replayed
    // every idle frame through the exact same rotateTrackByPixels() the
    // live drag uses, with the speed easing down toward the baseline via
    // springValue() parametrized by time-since-release -- always
    // actually turning at some point between release speed and
    // baseline, never a "settles at zero, then restarts" seam. The
    // baseline itself (this component's own idle spin) is just this
    // same replay with hasReleased still false.
    let momentumDirX = 1;
    let momentumDirY = 0;
    let releaseSpeed = BASELINE_SPEED_PX;
    let releaseTime = 0;
    let hasReleased = false;

    // Shared by the real pointerup/pointercancel AND the stale-timeout
    // check in tick() below -- whichever notices the movement has
    // actually stopped first gets to seed the coast; the other is then
    // a no-op (guarded by liveInputActive already being false).
    function finalizeMomentum() {
      if (trackedSpeed > MIN_FLICK_SPEED_PX) {
        momentumDirX = trackedDirX;
        momentumDirY = trackedDirY;
        releaseSpeed = Math.min(trackedSpeed, MAX_FLICK_SPEED_PX);
      } else {
        releaseSpeed = Math.max(releaseSpeed, BASELINE_SPEED_PX);
      }
      releaseTime = (performance.now() - startTime) / 1000;
      hasReleased = true;
    }

    function updatePointer(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      hovering = true;
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
      updatePointer(e);
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
      rotateTrackByPixels(dx, dy);

      const dist = Math.hypot(dx, dy);
      const instSpeed = (dist / dtMs) * 1000;
      const decay = Math.pow(0.5, dtMs / PEAK_HOLD_HALF_LIFE_MS);
      trackedSpeed = Math.max(instSpeed, trackedSpeed * decay);
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
    function onPointerLeave() {
      hovering = false;
    }
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);

    if (import.meta.env.DEV) {
      // Dev-only inspection hook, same pattern as LoadingScreen3D's own
      // __loadingGraphReview -- lets the momentum/hover state be
      // measured directly instead of inferred from screenshots.
      (window as unknown as { __infinityTrackReview: unknown }).__infinityTrackReview = {
        camera,
        trackRoot,
        tileMesh,
        getMomentumState: () => ({ dragging, liveInputActive, momentumDirX, momentumDirY, releaseSpeed, releaseTime, hasReleased, trackedSpeed }),
        getHoverState: () => ({ hovering, haveHit: lastHaveHit, hitPoint: hitPoint.clone() }),
        getPulseState: () => ({ pulseActive, pulseStart, nextPulseAt }),
        getGlowSample: () => Array.from(glowColors.slice(0, 9)),
      };
    }

    let raf = 0;
    let disposed = false;
    let lastElapsed = 0;
    const startTime = performance.now();

    // Gruvbox pulse scheduling -- see PULSE_INTERVAL_S's own comment.
    let pulseActive = false;
    let pulseStart = 0;
    let nextPulseAt = PULSE_INTERVAL_S;

    function tick() {
      if (disposed) return;
      const elapsed = (performance.now() - startTime) / 1000;
      const dt = Math.min(0.1, Math.max(0, elapsed - lastElapsed));
      lastElapsed = elapsed;

      // See STALE_TIMEOUT_MS's own comment on the ported version of
      // this in LoadingScreen3D.tsx: macOS's three-finger-drag trackpad
      // gesture keeps the virtual pointer "down" for a few hundred ms
      // after fingers actually lift, delivering zero events for that
      // whole gap -- indistinguishable from a genuinely still pointer
      // until treated as an effective release after this long without
      // a fresh pointermove.
      if (dragging && liveInputActive && performance.now() - lastMoveTime > STALE_TIMEOUT_MS) {
        liveInputActive = false;
        finalizeMomentum();
      }

      if (!liveInputActive) {
        const currentSpeed = hasReleased
          ? springValue(elapsed - releaseTime, releaseSpeed, BASELINE_SPEED_PX, MOMENTUM_TENSION, MOMENTUM_FRICTION)
          : BASELINE_SPEED_PX;
        rotateTrackByPixels(momentumDirX * currentSpeed * dt, momentumDirY * currentSpeed * dt);
      }

      // The rotation just applied above only lands in trackRoot's own
      // .quaternion -- matrixWorld (what the raycaster below actually
      // tests against) isn't recomputed until the scene graph updates,
      // which normally only happens inside renderer.render() at the
      // *end* of this function. Without forcing it here first, every
      // hover raycast would be testing against last frame's orientation
      // instead of this one -- for a shape that's often at least a
      // little in motion (idle spin, momentum coasting), that shows up
      // as hover intermittently missing tiles it should be hitting.
      trackRoot.updateMatrixWorld(true);

      // Hover: find the hit point (if any) this frame, then set every
      // tile's *target* lift from its distance to that point.
      //
      // The raycaster's hit point comes back in *world* space (it's
      // testing against the mesh's actual current matrixWorld, rotation
      // included), but every tile's basePosition was computed once, up
      // front, in the track's own *local* space and never touched
      // again. Comparing them directly only happened to work at the
      // track's starting orientation -- the moment it's rotated at all
      // (which is constantly, between the idle spin and momentum), the
      // two spaces diverge, and by however much the shape has been
      // rotated the falloff below ends up measuring distance to
      // entirely the wrong place. That's the actual mechanism behind
      // hover "not working on the back" -- getting a good look at the
      // back requires rotating a lot, which is exactly when this
      // mismatch is largest. worldToLocal() undoes the rotation on the
      // hit point once per frame, which is far cheaper than the
      // alternative (transforming every tile's position into world
      // space instead, hundreds of times, every frame).
      let haveHit = false;
      if (hovering && !dragging) {
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObject(tileMesh);
        if (hits.length > 0) {
          hitPoint.copy(hits[0].point);
          trackRoot.worldToLocal(hitPoint);
          haveHit = true;
        }
      }
      lastHaveHit = haveHit;
      for (let i = 0; i < tileCount; i++) {
        if (haveHit) {
          const dist = tiles[i].basePosition.distanceTo(hitPoint);
          const falloff = Math.max(0, 1 - dist / HOVER_RADIUS);
          liftTarget[i] = falloff * falloff * MAX_LIFT;
        } else {
          liftTarget[i] = 0;
        }
        liftCurrent[i] += (liftTarget[i] - liftCurrent[i]) * (1 - Math.exp(-LIFT_RESPONSIVENESS * dt));
      }

      const frontier = Math.min(1, elapsed / GROWTH_DURATION_S);

      // Gruvbox pulse scheduling -- resolved *before* painting tiles
      // below, since a pulse now also drives a tile blowout timed to
      // its own sweep position, not just the glow strand's color. Only
      // once the track is fully grown (a rainbow band -- or a blowout
      // -- sweeping a still-forming loop would read as broken, not
      // deliberate). pulseProgress stays -1 whenever no pulse is
      // currently in flight.
      let pulseProgress = -1;
      if (PULSE_ENABLED && frontier >= 1) {
        if (!pulseActive && elapsed >= nextPulseAt) {
          pulseActive = true;
          pulseStart = elapsed;
        }
        if (pulseActive) {
          const p = (elapsed - pulseStart) / PULSE_DURATION_S;
          if (p >= 1) {
            pulseActive = false;
            nextPulseAt = elapsed + PULSE_INTERVAL_S + (Math.random() - 0.5) * 2 * PULSE_INTERVAL_JITTER_S;
          } else {
            pulseProgress = p;
          }
        }
      }

      // Growth: a frontier sweeps around the loop (0..1 of `along`);
      // once it passes a tile, that tile's own pop-in spring starts
      // (timestamped once, not re-triggered), growing it from 0 to 1.
      for (let i = 0; i < tileCount; i++) {
        const tile = tiles[i];
        if (poppedAt[i] < 0 && tile.along <= frontier) poppedAt[i] = elapsed;
        const growScale = poppedAt[i] < 0 ? 0 : Math.max(0, springValue(elapsed - poppedAt[i], 0, 1, POP_TENSION, POP_FRICTION));

        let lift = liftCurrent[i];
        let chaosJitter = 0;
        if (pulseProgress >= 0) {
          // Shortest distance around the loop between this tile and
          // the pulse's current position, not a flat difference -- the
          // loop wraps, so a tile just behind along=0 and the pulse
          // just past along=1 are actually close together.
          let d = Math.abs(tile.along - pulseProgress);
          if (d > 0.5) d = 1 - d;
          if (d < PULSE_TILE_WINDOW) {
            const w = 1 - d / PULSE_TILE_WINDOW; // 1 right at the pulse's position, 0 at the window's edge
            // Each tile's own peak lift varies with its fixed seed, on
            // top of the window's own smooth falloff -- a perfectly
            // uniform wave across a whole ring reads as mechanical;
            // per-tile variation reads as something breaking apart.
            const tileLift = PULSE_TILE_LIFT * (0.4 + chaosSeeds[i] * 0.6) * w;
            if (tileLift > lift) lift = tileLift;
            chaosJitter = w;
          }
        }

        paintTile(i, tile, growScale, lift, chaosJitter);
      }
      tileMesh.instanceMatrix.needsUpdate = true;

      // The glow strand: each point stays fully dark until the growth
      // frontier reaches it (mirrors the tiles' own gating, just via
      // color instead of scale, since a Points object has no per-
      // vertex scale to speak of), then shows a traveling brightness
      // wave -- the "energy flowing" read that used to come from a
      // scrolling texture, now from each point's own oscillating
      // brightness -- and, if a pulse is currently passing this point,
      // blends toward the Gruvbox gradient sampled across the pulse's
      // own window instead.
      for (let i = 0; i < GLOW_POINT_COUNT; i++) {
        const along = glowAlong[i];
        if (along > frontier) {
          glowColors[i * 3] = 0;
          glowColors[i * 3 + 1] = 0;
          glowColors[i * 3 + 2] = 0;
          continue;
        }

        const wave = 0.55 + 0.45 * Math.sin(along * GLOW_WAVE_COUNT * Math.PI * 2 - elapsed * GLOW_SCROLL_SPEED * Math.PI * 2);
        scratchColor.copy(GLOW_BASE_COLOR).multiplyScalar(wave);

        if (pulseProgress >= 0) {
          let delta = along - pulseProgress;
          if (delta > 0.5) delta -= 1;
          if (delta < -0.5) delta += 1;
          if (Math.abs(delta) < PULSE_GLOW_WINDOW) {
            const w = 1 - Math.abs(delta) / PULSE_GLOW_WINDOW;
            // Maps across the *whole* window (not just 0 to the
            // midpoint), so the band shows a real sweep through the
            // palette as it passes a given point, not one flat hue.
            const bandT = delta / PULSE_GLOW_WINDOW / 2 + 0.5;
            gruvboxColorAt(bandT, rainbowColor);
            scratchColor.lerp(rainbowColor, w);
          }
        }

        glowColors[i * 3] = scratchColor.r;
        glowColors[i * 3 + 1] = scratchColor.g;
        glowColors[i * 3 + 2] = scratchColor.b;
      }
      glowColorAttr.needsUpdate = true;

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
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.dispose();
      tileGeometry.dispose();
      tileMaterial.dispose();
      glowGeometry.dispose();
      glowMaterial.dispose();
      glowSprite.dispose();
      pmrem.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [reduced]);

  return <div ref={containerRef} className="h-full w-full cursor-grab" />;
}
