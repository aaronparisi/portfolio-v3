import * as THREE from "three";

/**
 * A multivariable calculus surface, rendered CalcPlot3D-style: colored
 * axes and a vertex-colored surface mesh for f(x, y) = 7xy / e^(x^2+y^2)
 * -- a saddle-like function with two symmetric humps that decays to
 * (almost) flat away from the origin, chosen because that decay keeps
 * the whole interesting shape inside a modest domain instead of running
 * off to infinity. Grid lines (createSurfaceWireframe) are drawn
 * directly on the surface itself, not as a separate bounding box of
 * reference planes floating around it -- an earlier version tried the
 * latter and it just read as a grid box with a surface inside it,
 * rather than a grid *on* the surface.
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
const AXIS_LENGTH = 3.5;

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
    // Pushes this surface's own depth back a hair so createSurfaceWireframe's
    // lines -- which sit at literally the same coordinates -- render
    // cleanly on top instead of z-fighting/flickering against it.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  return new THREE.Mesh(geo, material);
}

// Every Nth row/column of the *same* fine mesh above becomes a visible
// grid line, traced as a run of short segments along the intervening
// fine vertices rather than one straight line between distant nodes --
// straight-line shortcuts would visibly cut across the surface's real
// curvature (a chord instead of the arc) anywhere it isn't nearly flat.
// Reusing the exact same evaluateF()/GRAPH_DOMAIN math as the shaded
// surface guarantees these lines sit exactly on it, not a separate
// grid floating nearby.
const GRID_LINE_STRIDE = 7; // 84 / 7 = 12 divisions (13 lines) each direction

export function createSurfaceWireframe(): THREE.LineSegments {
  const positions: number[] = [];

  function point(i: number, j: number): [number, number, number] {
    const mathX = -GRAPH_DOMAIN + (i / SEGMENTS) * (2 * GRAPH_DOMAIN);
    const mathY = -GRAPH_DOMAIN + (j / SEGMENTS) * (2 * GRAPH_DOMAIN);
    return [mathX, evaluateF(mathX, mathY), mathY];
  }

  for (let j = 0; j <= SEGMENTS; j += GRID_LINE_STRIDE) {
    for (let i = 0; i < SEGMENTS; i++) {
      positions.push(...point(i, j), ...point(i + 1, j));
    }
  }
  for (let i = 0; i <= SEGMENTS; i += GRID_LINE_STRIDE) {
    for (let j = 0; j < SEGMENTS; j++) {
      positions.push(...point(i, j), ...point(i, j + 1));
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: 0x1d2021, transparent: true, opacity: 0.45 });
  return new THREE.LineSegments(geo, material);
}

/**
 * Re-sorts a surface geometry's index buffer by each triangle's
 * horizontal distance from the origin (nearest first) and returns that
 * sorted distance list. Pair this with geometry.setDrawRange() and
 * revealCountForRadius() to make the mesh visibly render outward from
 * (0,0,0) -- an animated uniform scale on the whole mesh only makes an
 * already-complete shape bigger or smaller, it never actually looks
 * like new surface is appearing; this makes the surface itself, as
 * data, come into existence ring by ring the way a real plotting
 * routine or calculus-visualization tool would draw it.
 */
export function prepareRadialReveal(geometry: THREE.BufferGeometry): Float32Array {
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  if (!index || !position) return new Float32Array(0);

  const triangleCount = index.count / 3;
  const order = new Array<number>(triangleCount);
  const radii = new Float32Array(triangleCount);

  for (let t = 0; t < triangleCount; t++) {
    order[t] = t;
    const a = index.getX(t * 3);
    const b = index.getX(t * 3 + 1);
    const c = index.getX(t * 3 + 2);
    // World X and Z carry math x and math y (see file header) -- the
    // reveal spreads across that horizontal plane, ignoring height, so
    // it reads as "outward from the origin in x and y" the way the
    // domain itself grows, not as some unrelated 3D sphere expanding.
    const cx = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
    const cz = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
    radii[t] = Math.sqrt(cx * cx + cz * cz);
  }

  order.sort((i, j) => radii[i] - radii[j]);

  const sortedIndex = new Uint16Array(index.count);
  const sortedRadii = new Float32Array(triangleCount);
  for (let t = 0; t < triangleCount; t++) {
    const original = order[t];
    sortedIndex[t * 3] = index.getX(original * 3);
    sortedIndex[t * 3 + 1] = index.getX(original * 3 + 1);
    sortedIndex[t * 3 + 2] = index.getX(original * 3 + 2);
    sortedRadii[t] = radii[original];
  }

  geometry.setIndex(new THREE.BufferAttribute(sortedIndex, 1));
  geometry.setDrawRange(0, 0);
  return sortedRadii;
}

/** Binary search: how many of the (radius-sorted) triangles have a centroid at or inside `radius`. */
export function revealCountForRadius(sortedRadii: Float32Array, radius: number): number {
  let lo = 0;
  let hi = sortedRadii.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedRadii[mid] <= radius) lo = mid + 1;
    else hi = mid;
  }
  return lo;
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


export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    // THREE.Line covers LineSegments too (GridHelper extends
    // LineSegments) -- easy to forget since neither is a Mesh, and a
    // missed case here just quietly leaks that geometry/material
    // instead of throwing.
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite || obj instanceof THREE.Line) {
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

// springValue moved to ~/utils/springValue -- it's a genuinely generic
// utility (paired with a manual requestAnimationFrame loop, no
// react-spring involved), not something specific to this 3D scene, and
// it's since been reused for the loading button's bouncing dots too.
export { springValue } from "~/utils/springValue";
