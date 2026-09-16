import * as THREE from "three";

/**
 * A multivariable calculus surface, rendered CalcPlot3D-style: colored
 * axes, a floor grid, and a vertex-colored surface mesh for
 * f(x, y) = 7xy / e^(x^2+y^2) -- a saddle-like function with two
 * symmetric humps that decays to (almost) flat away from the origin,
 * chosen because that decay keeps the whole interesting shape inside a
 * modest domain instead of running off to infinity.
 *
 * Three.js's own "up" axis is Y, but the usual math convention for a
 * z = f(x, y) surface puts z vertical -- rather than fight that, world
 * X and world Z carry math x and math y (the horizontal plane), and
 * world Y carries the computed height (math z). The axis label text is
 * what a viewer actually reads, so this remapping is invisible: the
 * blue vertical rod is labeled "z" regardless of which Three.js axis
 * it's actually attached to.
 */

export const GRAPH_DOMAIN = 3;
const SEGMENTS = 84;
const AXIS_LENGTH = 4.2;

export function evaluateF(x: number, y: number): number {
  return (7 * x * y) / Math.exp(x * x + y * y);
}

// Gruvbox bright, used as a diverging colormap keyed to height -- red at
// the lowest trough, up through orange/yellow near zero, to green/blue
// at the highest crest. f's range here is about [-1.29, 1.29] (the
// extrema sit where x = y = ±1/sqrt(2)).
const COLOR_STOPS: [number, THREE.Color][] = [
  [-1.3, new THREE.Color(0xfb4934)],
  [-0.55, new THREE.Color(0xfe8019)],
  [0, new THREE.Color(0xfabd2f)],
  [0.55, new THREE.Color(0xb8bb26)],
  [1.3, new THREE.Color(0x83a598)],
];

function colorForHeight(z: number, out: THREE.Color): THREE.Color {
  const clamped = Math.max(COLOR_STOPS[0][0], Math.min(COLOR_STOPS[COLOR_STOPS.length - 1][0], z));
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const [z0, c0] = COLOR_STOPS[i];
    const [z1, c1] = COLOR_STOPS[i + 1];
    if (clamped >= z0 && clamped <= z1) {
      const t = (clamped - z0) / (z1 - z0);
      return out.copy(c0).lerp(c1, t);
    }
  }
  return out.copy(COLOR_STOPS[COLOR_STOPS.length - 1][1]);
}

/**
 * Built as an explicit BufferGeometry (positions/colors/indices filled
 * in a loop) rather than displacing a THREE.PlaneGeometry -- a
 * rotate(-90°) on a plane to lay it flat swaps and negates axes in a
 * way that's easy to get backwards, and this way there's never any
 * doubt which array index is math x, math y, or the computed height.
 * DoubleSide on the material (set by the caller) makes triangle winding
 * irrelevant, so there's no need to fuss over index order either.
 */
export function createSurfaceGeometry(): THREE.BufferGeometry {
  const rowSize = SEGMENTS + 1;
  const positions = new Float32Array(rowSize * rowSize * 3);
  const colors = new Float32Array(rowSize * rowSize * 3);
  const scratch = new THREE.Color();

  let p = 0;
  for (let j = 0; j <= SEGMENTS; j++) {
    const mathY = -GRAPH_DOMAIN + (j / SEGMENTS) * (2 * GRAPH_DOMAIN);
    for (let i = 0; i <= SEGMENTS; i++) {
      const mathX = -GRAPH_DOMAIN + (i / SEGMENTS) * (2 * GRAPH_DOMAIN);
      const z = evaluateF(mathX, mathY);
      positions[p] = mathX;
      positions[p + 1] = z;
      positions[p + 2] = mathY;
      colorForHeight(z, scratch);
      colors[p] = scratch.r;
      colors[p + 1] = scratch.g;
      colors[p + 2] = scratch.b;
      p += 3;
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < SEGMENTS; j++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = j * rowSize + i;
      const b = a + 1;
      const c = a + rowSize;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function createSurfaceMesh(): THREE.Mesh {
  const geo = createSurfaceGeometry();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, material);
}

function createAxisLabel(text: string, colorCss: string): THREE.Sprite {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.font = "bold 92px ui-monospace, monospace";
    ctx.fillStyle = colorCss;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, size / 2, size / 2 + 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(0.55, 0.55, 1);
  return sprite;
}

// A rod through the origin (CylinderGeometry's local +Y, centered) plus
// an arrowhead and a text label at the positive end, all as children of
// one group -- animating that single group's scale from the origin
// grows the rod's length AND slides the tip/label outward together,
// since every child's position is already "some distance from the
// origin" and uniform scaling scales all of those distances at once.
function createAxisRod(colorHex: number, label: string, alignTo: "x" | "y" | "z"): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.45, metalness: 0.1 });

  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, AXIS_LENGTH * 2, 12), material);
  group.add(rod);

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 16), material);
  tip.position.y = AXIS_LENGTH + 0.16;
  group.add(tip);

  const labelSprite = createAxisLabel(label, `#${colorHex.toString(16).padStart(6, "0")}`);
  labelSprite.position.y = AXIS_LENGTH + 0.6;
  group.add(labelSprite);

  // Local +Y (the rod's own length direction) rotated to align with the
  // requested world axis; verified against the standard rotation
  // matrices rather than guessed, since a sign error here just points
  // an axis backwards with no error to catch it.
  if (alignTo === "x") group.rotation.z = -Math.PI / 2;
  if (alignTo === "z") group.rotation.x = Math.PI / 2;
  return group;
}

export interface AxesGroup {
  root: THREE.Group;
  worldXAxis: THREE.Group; // math x, red
  worldYAxis: THREE.Group; // math z (height), blue -- Three.js's vertical axis
  worldZAxis: THREE.Group; // math y, green
}

export function createAxesGroup(): AxesGroup {
  const root = new THREE.Group();
  const worldXAxis = createAxisRod(0xfb4934, "x", "x");
  const worldYAxis = createAxisRod(0x83a598, "z", "y");
  const worldZAxis = createAxisRod(0xb8bb26, "y", "z");
  root.add(worldXAxis, worldYAxis, worldZAxis);
  return { root, worldXAxis, worldYAxis, worldZAxis };
}

export function createFloorGrid(): THREE.GridHelper {
  const grid = new THREE.GridHelper(GRAPH_DOMAIN * 2 + 1, 14, 0x504945, 0x3c3836);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.6;
  return grid;
}

export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
      obj.geometry?.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        const map = (m as THREE.MeshBasicMaterial | THREE.SpriteMaterial).map;
        map?.dispose();
        m.dispose();
      });
    }
  });
}

/**
 * The closed-form solution to a damped harmonic oscillator (mass 1,
 * starting at rest), evaluated directly from elapsed time rather than
 * numerically stepped like react-spring does -- this scene's motion
 * lives entirely inside a requestAnimationFrame loop driven by its own
 * THREE.Clock, not by React renders, so treating "value at time t" as a
 * pure function is simpler than wiring a second animation library into
 * a loop that already isn't React-driven. `tension`/`friction` mean the
 * same thing they do everywhere else react-spring is used on this site.
 */
export function springValue(t: number, from: number, to: number, tension: number, friction: number): number {
  if (t <= 0) return from;
  const omega0 = Math.sqrt(tension);
  const zeta = friction / (2 * Math.sqrt(tension));
  const delta = to - from;
  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const envelope = Math.exp(-zeta * omega0 * t);
    return to - delta * envelope * (Math.cos(omegaD * t) + ((zeta * omega0) / omegaD) * Math.sin(omegaD * t));
  }
  const envelope = Math.exp(-omega0 * t);
  return to - delta * envelope * (1 + omega0 * t);
}
