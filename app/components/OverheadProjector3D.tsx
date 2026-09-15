import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  createOverheadProjectorModel,
  createOverheadProjectorEnvironment,
  frameOverheadProjectorCamera,
  configureOverheadProjectorRenderer,
  createOverheadProjectorInspectControls,
} from "~/three/createOverheadProjector";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

/**
 * An interactive overhead projector, reconstructed via the img2threejs
 * pipeline from a real reference photo (see .img2threejs-projector/ and
 * app/three/createOverheadProjector.ts for the full reconstruction trail).
 * Drag to orbit; a small idle sway keeps it feeling alive when no one's
 * touching it, the same language as AaronBust3D's own idle animation.
 */
export function OverheadProjector3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

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
    const clock = new THREE.Clock();

    function tick() {
      if (disposed) return;
      if (!reduced) {
        model.rotation.y = Math.sin(clock.getElapsedTime() * 0.35) * 0.1;
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
    <div
      ref={containerRef}
      className="aspect-square w-full cursor-grab touch-none active:cursor-grabbing"
      role="img"
      aria-label="An interactive 3D overhead projector. Drag to rotate."
    />
  );
}
