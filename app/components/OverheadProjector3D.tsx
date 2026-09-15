import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  createOverheadProjectorModel,
  createOverheadProjectorEnvironment,
  frameOverheadProjectorCamera,
  configureOverheadProjectorRenderer,
  createOverheadProjectorInspectControls,
} from "~/three/createOverheadProjector";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

const LAMP_COLOR = new THREE.Color(0xffd9a0);
const IDLE_INTENSITY = 0.55;

/**
 * An interactive overhead projector, reconstructed via the img2threejs
 * pipeline from a real reference photo (see .img2threejs-projector/ and
 * app/three/createOverheadProjector.ts for the full reconstruction trail).
 *
 * Interaction-pass additions: click the power switch (or the button below)
 * to turn the lamp on, then drag the blue dial to bring the beam up and
 * down -- the same two controls the real object has, driving a real
 * SpotLight + a beam-cone mesh in the site's own accent-warm color, the
 * same one the hero's light-cone glows from (app/app.css --accent-warm).
 * Drag anywhere else to orbit; a small idle sway keeps it feeling alive
 * when no one's touching it.
 */
export function OverheadProjector3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const [powered, setPowered] = useState(false);
  const poweredRef = useRef(false);
  const dialIntensityRef = useRef(IDLE_INTENSITY);

  useEffect(() => {
    poweredRef.current = powered;
  }, [powered]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 30);

    // preserveDrawingBuffer: dev-review Playwright captures read the canvas back
    // (bounding-box detection for reference-matched reframing) -- negligible
    // cost for this scene's triangle budget.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    configureOverheadProjectorRenderer(renderer);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const model = createOverheadProjectorModel();
    scene.add(model);

    if (import.meta.env.DEV) {
      const parts: { name: string; kind: string; triangles: number }[] = [];
      let unnamedMeshes = 0;
      model.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const triangles = obj.geometry.index
            ? obj.geometry.index.count / 3
            : obj.geometry.attributes.position.count / 3;
          if (!obj.name) unnamedMeshes += 1;
          else parts.push({ name: obj.name, kind: "part", triangles: Math.round(triangles) });
        }
      });
      (window as unknown as { __projectorParts: unknown }).__projectorParts = {
        model: "overhead-projector",
        parts,
        unnamedMeshes,
        integralMeshes: parts.length,
      };
      // Dev-only review hook: lets the img2threejs Playwright capture script
      // orbit the model to specific angles for multi-angle Tier-1 diagnostics
      // without needing to simulate real drag gestures headlessly.
      (window as unknown as { __projectorReview: unknown }).__projectorReview = { model, camera };
    }

    // Matches object-sculpt-spec.json's lightingFromPhoto exactly.
    const key = new THREE.DirectionalLight(0xf5f0e6, 1.3);
    key.position.set(0.4, 0.85, 0.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xdfe3ea, 0.5);
    fill.position.set(-0.5, 0.4, -0.3);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xe8bc78, 0.45);
    rim.position.set(-0.6, 0.5, -0.6);
    scene.add(rim);

    scene.environment = createOverheadProjectorEnvironment(renderer);

    frameOverheadProjectorCamera(camera, model, { margin: 1.35, elevationDeg: 8 });

    const groundBox = new THREE.Box3().setFromObject(model);
    const shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.ShadowMaterial({ opacity: 0.28 }),
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = groundBox.min.y;
    shadowCatcher.receiveShadow = true;
    scene.add(shadowCatcher);

    const controls = createOverheadProjectorInspectControls(camera, renderer.domElement);
    controls.target.set(0, (groundBox.min.y + groundBox.max.y) / 2, 0);
    controls.enablePan = false;
    controls.autoRotate = false;
    controls.update();

    // --- interaction-pass: real controls on the real moving parts ---------
    //
    // The power switch toggles the lamp; the dial (draggable once powered)
    // sweeps the beam's intensity. Both are found by their spec component
    // id, set on every node/mesh's userData.sculptComponent by the
    // generator -- not by mesh name, which is a free-text label.
    function findComponent(id: string): THREE.Object3D | null {
      let found: THREE.Object3D | null = null;
      model.traverse((obj) => {
        if (found) return;
        const sc = (obj.userData as { sculptComponent?: { id?: string } }).sculptComponent;
        if (sc?.id === id) found = obj;
      });
      return found;
    }
    const dialPivot = findComponent("controlDialKnob");
    const switchPivot = findComponent("powerSwitchLever");
    const lensBarrel = findComponent("lensBarrel");
    const platenMesh = findComponent("platen") as THREE.Mesh | null;
    const platenMaterial = (platenMesh?.material as THREE.MeshPhysicalMaterial | undefined) ?? null;
    if (platenMaterial) {
      platenMaterial.emissive = LAMP_COLOR.clone();
      platenMaterial.emissiveIntensity = 0;
    }
    const switchBaseRotation = switchPivot ? switchPivot.rotation.x : 0;
    // The dial's authored static pose tilts it face-forward on X (rotation =
    // (HALF_PI, 0, 0), see object-sculpt-spec.json's controlDialKnob) --
    // preserve that tilt and spin it on its own Y axis for the "turning a
    // dial" look, rather than overwriting X (which would flip it back to
    // standing upright).
    const dialBaseRotationX = dialPivot ? dialPivot.rotation.x : Math.PI / 2;

    // A real SpotLight plus the platen's own emissive glow carries the "lamp
    // turning on" moment on its own -- an earlier attempt at an additive
    // beam-cone mesh on top of that rendered as a muddy dark wedge instead of
    // a glow (likely a blending/tone-mapping interaction not worth chasing
    // for a decorative flourish) and was cut rather than shipped broken.
    const beam = new THREE.SpotLight(0xffd9a0, 0, 0, Math.PI / 7, 0.5, 1.4);
    beam.castShadow = false;
    scene.add(beam);
    scene.add(beam.target);

    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let dialDragging = false;
    let dialDragStartX = 0;
    let dialDragStartIntensity = IDLE_INTENSITY;
    let dialAngle = 0;

    function componentIdAt(clientX: number, clientY: number): string | null {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObject(model, true);
      for (const hit of hits) {
        const sc = (hit.object.userData as { sculptComponent?: { id?: string } }).sculptComponent;
        if (sc?.id) return sc.id;
      }
      return null;
    }

    function onPointerDown(event: PointerEvent) {
      const id = componentIdAt(event.clientX, event.clientY);
      if (id === "powerSwitchLever") {
        setPowered((prev) => !prev);
        return;
      }
      if (id === "controlDialKnob" && dialPivot) {
        dialDragging = true;
        dialDragStartX = event.clientX;
        dialDragStartIntensity = dialIntensityRef.current;
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
      }
    }
    function onPointerMove(event: PointerEvent) {
      if (!dialDragging || !dialPivot) return;
      const deltaX = event.clientX - dialDragStartX;
      const next = THREE.MathUtils.clamp(dialDragStartIntensity + deltaX / 160, 0.12, 1);
      dialIntensityRef.current = next;
      dialAngle = (next - 0.12) * 5.4;
      dialPivot.rotation.set(dialBaseRotationX, dialAngle, 0);
      if (next > dialDragStartIntensity + 0.02 || poweredRef.current) {
        setPowered(true);
      }
    }
    function onPointerUp(event: PointerEvent) {
      if (!dialDragging) return;
      dialDragging = false;
      controls.enabled = true;
      try {
        renderer.domElement.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    }
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);

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

    // Ensure world matrices are valid before the first frame reads
    // lensBarrel/platen world positions (renderer.render() keeps them
    // current on every later frame).
    model.updateMatrixWorld(true);

    let raf = 0;
    let disposed = false;
    const clock = new THREE.Clock();
    let currentGlow = 0;
    const lensWorld = new THREE.Vector3();
    const targetWorld = new THREE.Vector3();

    function tick() {
      if (disposed) return;
      if (!reduced && !dialDragging) {
        model.rotation.y = Math.sin(clock.getElapsedTime() * 0.35) * 0.1;
      }

      // Switch flips a few degrees to feel like a real toggle.
      if (switchPivot) {
        const targetTilt = poweredRef.current ? switchBaseRotation + 0.5 : switchBaseRotation;
        switchPivot.rotation.x += (targetTilt - switchPivot.rotation.x) * 0.25;
      }

      const targetGlow = poweredRef.current ? dialIntensityRef.current : 0;
      currentGlow += (targetGlow - currentGlow) * 0.12;

      if (platenMaterial) platenMaterial.emissiveIntensity = currentGlow * 0.9;

      if (lensBarrel && platenMesh) {
        lensBarrel.getWorldPosition(lensWorld);
        platenMesh.getWorldPosition(targetWorld);
        beam.position.copy(lensWorld);
        beam.target.position.copy(targetWorld);
        beam.intensity = currentGlow * 6;
        beam.distance = lensWorld.distanceTo(targetWorld) * 1.6;
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
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      controls.dispose();
      renderer.dispose();
      scene.environment?.dispose();
      shadowCatcher.geometry.dispose();
      (shadowCatcher.material as THREE.Material).dispose();
      model.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => m.dispose());
        }
      });
      container.removeChild(renderer.domElement);
    };
  }, [reduced]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={containerRef}
        className="aspect-square w-full cursor-grab touch-none active:cursor-grabbing"
        role="img"
        aria-label="An interactive 3D overhead projector. Drag to rotate, click the switch or drag the blue dial to turn on the lamp."
      />
      <button
        type="button"
        onClick={() => setPowered((p) => !p)}
        className="annotation cursor-pointer border-none bg-transparent text-sm"
        style={{ color: "var(--accent)" }}
      >
        {powered ? "turn off the lamp" : "turn on the lamp"}
      </button>
    </div>
  );
}
