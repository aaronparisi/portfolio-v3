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

const DRAG_SENSITIVITY = 0.008;
const IDLE_ROTATE_SPEED = 0.05;

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
    scene.add(tileMesh);

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
    scene.add(glowMesh);

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

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const worldUp = new THREE.Vector3(0, 1, 0);
    const cameraRightVec = new THREE.Vector3();
    function rotateByPixels(dx: number, dy: number) {
      cameraRightVec.setFromMatrixColumn(camera.matrixWorld, 0);
      const yawQuat = new THREE.Quaternion().setFromAxisAngle(worldUp, dx * DRAG_SENSITIVITY);
      const pitchQuat = new THREE.Quaternion().setFromAxisAngle(cameraRightVec, dy * DRAG_SENSITIVITY);
      tileMesh.quaternion.premultiply(yawQuat);
      glowMesh.quaternion.premultiply(yawQuat);
      tileMesh.quaternion.premultiply(pitchQuat);
      glowMesh.quaternion.premultiply(pitchQuat);
    }

    function updatePointer(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      hovering = true;
    }
    function onPointerDown(e: PointerEvent) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      updatePointer(e);
      if (!dragging) return;
      rotateByPixels(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    }
    function onPointerUp() {
      dragging = false;
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

    let raf = 0;
    let disposed = false;
    let lastElapsed = 0;
    const startTime = performance.now();

    function tick() {
      if (disposed) return;
      const elapsed = (performance.now() - startTime) / 1000;
      const dt = Math.min(0.1, Math.max(0, elapsed - lastElapsed));
      lastElapsed = elapsed;

      if (!dragging) tileMesh.rotateY(IDLE_ROTATE_SPEED * dt), glowMesh.rotateY(IDLE_ROTATE_SPEED * dt);

      // Hover: find the world hit point (if any) this frame, then set
      // every tile's *target* lift from its distance to that point.
      let haveHit = false;
      if (hovering && !dragging) {
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObject(tileMesh);
        if (hits.length > 0) {
          hitPoint.copy(hits[0].point);
          haveHit = true;
        }
      }
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
