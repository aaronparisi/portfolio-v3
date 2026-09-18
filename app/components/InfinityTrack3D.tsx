import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildTrackGeometry, curvePoint, type TileInstance } from "~/three/createInfinityTrack";
import { springValue } from "~/utils/springValue";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const STATIONS = 90;
const TILES_AROUND = 8;
const TUBE_RADIUS = 0.34;
const INNER_RADIUS = 0.22; // the glow tube, hidden just behind the tiles at rest

const TILE_GAP_FRACTION = 0.86; // tiles fill this much of their allotted space, leaving a visible seam
const TILE_THICKNESS = 0.05;

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

/**
 * The site's new hero centerpiece: an infinity symbol that's actually a
 * closed 3D "racetrack" (see createInfinityTrack.ts for the curve
 * math), built from small metal tiles rather than a smooth tube. Hover
 * anywhere on it and nearby tiles lift outward along their own surface
 * normal, revealing a glowing inner tube that's otherwise hidden just
 * behind them -- "breaking through" the plating. On mount it grows
 * itself into existence, ring by ring around the loop, each ring
 * popping in with a small spring overshoot right as the growth
 * frontier reaches it.
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

    const key = new THREE.DirectionalLight(0xfff4e0, 1.1);
    key.position.set(4, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xa8c8ff, 0.6);
    rim.position.set(-5, -2, -3);
    scene.add(rim);

    const { tiles, tileWidth, tileHeight } = buildTrackGeometry(STATIONS, TILES_AROUND, TUBE_RADIUS);
    const tileCount = tiles.length;

    const tileGeometry = new THREE.BoxGeometry(
      tileWidth * TILE_GAP_FRACTION,
      tileHeight * TILE_GAP_FRACTION,
      TILE_THICKNESS,
    );
    const tileMaterial = new THREE.MeshStandardMaterial({
      color: 0x2b2622,
      metalness: 0.92,
      roughness: 0.32,
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

    // The glow tube: a smooth, continuous tube along the same curve, a
    // little smaller than the tiles' own radius so it sits just behind
    // them at rest -- only visible in the gaps a lifted tile opens up.
    const glowPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= STATIONS; i++) {
      glowPoints.push(curvePoint((i / STATIONS) * Math.PI * 2));
    }
    const glowCurve = new THREE.CatmullRomCurve3(glowPoints, true);
    const glowGeometry = new THREE.TubeGeometry(glowCurve, STATIONS * 2, INNER_RADIUS, 12, true);
    const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xfabd2f, toneMapped: false });
    const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    trackRoot.add(glowMesh);

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

    function paintTile(i: number, tile: TileInstance, growScale: number, lift: number) {
      dummy.position.copy(tile.basePosition).addScaledVector(tile.outward, lift);
      dummy.quaternion.copy(tile.quaternion);
      dummy.scale.setScalar(growScale);
      dummy.updateMatrix();
      tileMesh.setMatrixAt(i, dummy.matrix);
    }

    if (reduced) {
      // No growth, no hover response -- the finished track, motionless.
      tiles.forEach((tile, i) => paintTile(i, tile, 1, 0));
      tileMesh.instanceMatrix.needsUpdate = true;
      resize();
      renderer.render(scene, camera);
      return () => {
        resizeObserver.disconnect();
        renderer.dispose();
        tileGeometry.dispose();
        tileMaterial.dispose();
        glowGeometry.dispose();
        glowMaterial.dispose();
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
      };
    }

    let raf = 0;
    let disposed = false;
    let lastElapsed = 0;
    const startTime = performance.now();

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

      // Growth: a frontier sweeps around the loop (0..1 of `along`);
      // once it passes a tile, that tile's own pop-in spring starts
      // (timestamped once, not re-triggered), growing it from 0 to 1.
      const frontier = Math.min(1, elapsed / GROWTH_DURATION_S);
      for (let i = 0; i < tileCount; i++) {
        const tile = tiles[i];
        if (poppedAt[i] < 0 && tile.along <= frontier) poppedAt[i] = elapsed;
        const growScale = poppedAt[i] < 0 ? 0 : Math.max(0, springValue(elapsed - poppedAt[i], 0, 1, POP_TENSION, POP_FRICTION));
        paintTile(i, tile, growScale, liftCurrent[i]);
      }
      tileMesh.instanceMatrix.needsUpdate = true;

      // The glow tube only ever needs to be as "grown" as the furthest
      // tile ring, and doesn't lift on hover -- it just needs to exist
      // behind wherever tiles have opened up.
      glowMesh.scale.setScalar(Math.min(1, frontier * 1.05));

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
      pmrem.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [reduced]);

  return <div ref={containerRef} className="h-full w-full cursor-grab" />;
}
