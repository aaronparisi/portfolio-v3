import * as THREE from "three";

/**
 * Three distinct closed-curve families the tiled track can be built
 * from -- the tile-sweep machinery below (buildTrackFrames/
 * buildTrackGeometry) only ever needs `curvePoint(config, t)` to trace
 * *some* smooth, non-self-intersecting closed loop; it doesn't care
 * which family produced it. That's what makes the site's own shape
 * morph (Experience3D.tsx) possible at all: every family shares the
 * exact same station/tilesAround/tubeRadius, so they produce identical
 * tile *topology* -- only where each tile sits differs -- and a whole
 * shape can be swapped for a real, different, lerp-able one instead of
 * just retuning one curve's own parameters.
 *
 * - "lemniscate": the original infinity racetrack (see its own comment
 *   below) -- chalk-era, analog, rounded.
 * - "roundedRect": a stadium/rounded-rectangle perimeter -- a screen
 *   bezel's own outline, flatter and far more rigid/geometric than the
 *   lemniscate.
 * - "zigzag": a closed loop built from a base circle plus a couple of
 *   integer-frequency sine harmonics -- an irregular, angular,
 *   circuit-trace-like silhouette. Guaranteed non-self-intersecting for
 *   free (not verified numerically, unlike the lemniscate): a polar
 *   curve r(t) > 0 swept once around a fixed center can never cross
 *   itself, so keeping the harmonic amplitudes comfortably below the
 *   base radius is the only real constraint, not a proof obligation.
 */
export type TrackShapeConfig =
  | { family: "lemniscate"; curveA: number; curveC: number; twistTurns: number }
  | { family: "roundedRect"; width: number; height: number; radius: number; depth: number; twistTurns: number }
  | {
      family: "zigzag";
      radius: number;
      ampA: number;
      freqA: number;
      ampB: number;
      freqB: number;
      depth: number;
      twistTurns: number;
    };

/**
 * The chalkboard-era shape everything was originally tuned against on
 * /infinity-preview: a flat lemniscate of Gerono, x = cos t, y =
 * sin t cos t, banked in z by C sin t so the two passes through the
 * shared (x, y) crossing point land at +C and -C -- a genuine 3D
 * "racetrack" that still reads as a flat infinity symbol head-on.
 * Verified numerically at the time (dense sampling + pairwise distance
 * check) that the closest approach anywhere on the loop is nowhere near
 * the crossing, and the crossing itself separates by a full 2*C,
 * comfortably more than twice the tube radius.
 */
export const SHAPE_TEACHER: TrackShapeConfig = { family: "lemniscate", curveA: 2.2, curveC: 0.9, twistTurns: 0 };
/** A monitor bezel's own outline -- flat, rigid, geometric. The "it's turned into a screen" beat. */
export const SHAPE_TERMINAL: TrackShapeConfig = { family: "roundedRect", width: 4.6, height: 3.1, radius: 0.6, depth: 0.18, twistTurns: 0.4 };
/** An irregular, angular closed loop -- the "fully digitized" resolved form. */
export const SHAPE_CIRCUIT: TrackShapeConfig = {
  family: "zigzag",
  radius: 2.3,
  ampA: 0.32,
  freqA: 5,
  ampB: 0.18,
  freqB: 8,
  depth: 0.4,
  twistTurns: 1.5,
};
/** The full journey, in order -- Experience3D.tsx blends through these by overall scroll progress. */
export const TRACK_SHAPES: TrackShapeConfig[] = [SHAPE_TEACHER, SHAPE_TERMINAL, SHAPE_CIRCUIT];

const HALF_PI = Math.PI / 2;

/** A stadium/rounded-rectangle perimeter, parametrized by arc length `s` around it. Center-origin, `w`/`h` full extents, `r` corner radius. */
function roundedRectXY(w: number, h: number, r: number, s: number, out: { x: number; y: number }) {
  const hw = w / 2;
  const hh = h / 2;
  const sx = w - 2 * r; // straight top/bottom run
  const sy = h - 2 * r; // straight left/right run
  const arcLen = HALF_PI * r;
  let u = s;
  if (u < sy) {
    out.x = hw;
    out.y = -hh + r + u;
    return;
  }
  u -= sy;
  if (u < arcLen) {
    const a = u / r;
    out.x = hw - r + r * Math.cos(a);
    out.y = hh - r + r * Math.sin(a);
    return;
  }
  u -= arcLen;
  if (u < sx) {
    out.x = hw - r - u;
    out.y = hh;
    return;
  }
  u -= sx;
  if (u < arcLen) {
    const a = HALF_PI + u / r;
    out.x = -hw + r + r * Math.cos(a);
    out.y = hh - r + r * Math.sin(a);
    return;
  }
  u -= arcLen;
  if (u < sy) {
    out.x = -hw;
    out.y = hh - r - u;
    return;
  }
  u -= sy;
  if (u < arcLen) {
    const a = Math.PI + u / r;
    out.x = -hw + r + r * Math.cos(a);
    out.y = -hh + r + r * Math.sin(a);
    return;
  }
  u -= arcLen;
  if (u < sx) {
    out.x = -hw + r + u;
    out.y = -hh;
    return;
  }
  u -= sx;
  const a = 1.5 * Math.PI + u / r;
  out.x = hw - r + r * Math.cos(a);
  out.y = -hh + r + r * Math.sin(a);
}

const rectScratch = { x: 0, y: 0 };

export function curvePoint(config: TrackShapeConfig, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  switch (config.family) {
    case "lemniscate":
      return out.set(config.curveA * Math.cos(t), config.curveA * Math.sin(t) * Math.cos(t), config.curveC * Math.sin(t));
    case "roundedRect": {
      const { width, height, radius, depth } = config;
      const sx = width - 2 * radius;
      const sy = height - 2 * radius;
      const perim = 2 * sx + 2 * sy + 2 * Math.PI * radius;
      let s = (t / (Math.PI * 2)) * perim;
      s = ((s % perim) + perim) % perim;
      roundedRectXY(width, height, radius, s, rectScratch);
      return out.set(rectScratch.x, rectScratch.y, depth * Math.sin(t * 3));
    }
    case "zigzag": {
      const { radius, ampA, freqA, ampB, freqB, depth } = config;
      const r = radius + ampA * Math.sin(t * freqA) + ampB * Math.sin(t * freqB + 0.7);
      return out.set(r * Math.cos(t), r * Math.sin(t), depth * Math.sin(t * 3 + 1.1));
    }
  }
}

interface TrackFrame {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
}

/**
 * A rotation-minimizing frame walked around the closed curve -- a naive
 * Frenet frame (built from the curve's second derivative) flips
 * violently wherever curvature passes through zero, which every one of
 * these curves does somewhere by construction, and a tube built from
 * those frames would show the whole cross-section suddenly twisting
 * there. Each station's normal is instead just the previous station's
 * normal projected into the new tangent's perpendicular plane and
 * renormalized (Gram-Schmidt) -- simpler than a full double-reflection
 * RMF, and produces no visible twist for a smooth closed curve sampled
 * this densely.
 */
function buildTrackFrames(config: TrackShapeConfig, stationCount: number): TrackFrame[] {
  const frames: TrackFrame[] = [];
  const delta = 0.0005;
  for (let i = 0; i < stationCount; i++) {
    const t = (i / stationCount) * Math.PI * 2;
    const position = curvePoint(config, t);
    const ahead = curvePoint(config, t + delta);
    const behind = curvePoint(config, t - delta);
    const tangent = ahead.sub(behind).normalize();
    frames.push({ position, tangent, normal: new THREE.Vector3(), binormal: new THREE.Vector3() });
  }

  const seed = new THREE.Vector3(0, 1, 0);
  if (Math.abs(frames[0].tangent.dot(seed)) > 0.99) seed.set(1, 0, 0);
  frames[0].normal
    .copy(seed)
    .sub(frames[0].tangent.clone().multiplyScalar(seed.dot(frames[0].tangent)))
    .normalize();
  frames[0].binormal.crossVectors(frames[0].tangent, frames[0].normal);

  for (let i = 1; i < stationCount; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];
    const projected = prev.normal.clone().sub(curr.tangent.clone().multiplyScalar(prev.normal.dot(curr.tangent)));
    curr.normal.copy(projected.lengthSq() > 1e-8 ? projected.normalize() : prev.normal);
    curr.binormal.crossVectors(curr.tangent, curr.normal);
  }

  return frames;
}

export interface TileInstance {
  basePosition: THREE.Vector3; // resting position, on the tube's surface
  outward: THREE.Vector3; // unit direction the tile lifts along on hover
  quaternion: THREE.Quaternion; // orientation matching the tube surface here
  along: number; // 0..1 fraction around the loop -- growth order
  ringT: number; // 0..1 fraction around the tube's own circumference at this station
}

export interface TrackGeometryInfo {
  tiles: TileInstance[];
  tileWidth: number; // along the tube's length
  tileHeight: number; // around the tube's circumference
  loopLength: number; // total arc length, for reference/tuning
}

/**
 * Lays tiles edge to edge over the tube's surface: `stationCount`
 * rings along the loop's length, `tilesAround` tiles per ring. Tile
 * size is a single average estimate (real arc length per station,
 * since this curve's parametrization isn't constant-speed, divided
 * out), not a per-tile exact fit -- a uniform size across a shared
 * InstancedMesh geometry, with small gaps baked into that size, reads
 * as a tiled surface without needing exact-fit trapezoids at every
 * station.
 */
export function buildTrackGeometry(
  config: TrackShapeConfig,
  stationCount: number,
  tilesAround: number,
  tubeRadius: number,
): TrackGeometryInfo {
  const frames = buildTrackFrames(config, stationCount);

  let loopLength = 0;
  for (let i = 0; i < stationCount; i++) {
    const next = frames[(i + 1) % stationCount];
    loopLength += frames[i].position.distanceTo(next.position);
  }
  const tileWidth = loopLength / stationCount;
  const tileHeight = (2 * Math.PI * tubeRadius) / tilesAround;

  const tiles: TileInstance[] = [];
  const basisMatrix = new THREE.Matrix4();
  for (let i = 0; i < stationCount; i++) {
    const frame = frames[i];
    // The twist: each ring's own start angle advances steadily over the
    // loop, `twistTurns` full turns by the time it closes back on
    // itself -- zero for an untwisted shape, a real spiral otherwise.
    // Applies identically regardless of which curve family produced
    // this station's frame.
    const twistOffset = (i / stationCount) * config.twistTurns * Math.PI * 2;
    for (let j = 0; j < tilesAround; j++) {
      const angle = (j / tilesAround) * Math.PI * 2 + twistOffset;
      const outward = frame.normal
        .clone()
        .multiplyScalar(Math.cos(angle))
        .add(frame.binormal.clone().multiplyScalar(Math.sin(angle)))
        .normalize();
      const basePosition = frame.position.clone().add(outward.clone().multiplyScalar(tubeRadius));

      // The tile's face normal (local +Z) is `outward`; local +X follows
      // the tube's length direction, re-orthogonalized against outward
      // so the basis stays valid even where tangent and outward aren't
      // already perpendicular-adjacent.
      const tileZ = outward;
      const tileX = frame.tangent.clone();
      tileX.sub(tileZ.clone().multiplyScalar(tileX.dot(tileZ))).normalize();
      const tileY = new THREE.Vector3().crossVectors(tileZ, tileX);
      basisMatrix.makeBasis(tileX, tileY, tileZ);
      const quaternion = new THREE.Quaternion().setFromRotationMatrix(basisMatrix);

      tiles.push({ basePosition, outward, quaternion, along: i / stationCount, ringT: j / tilesAround });
    }
  }

  return { tiles, tileWidth, tileHeight, loopLength };
}

export interface TrackGeometrySet {
  tileCount: number;
  along: Float32Array; // shared across every shape -- same topology/order
  ringT: Float32Array; // shared too -- each tile's fixed position around the tube's own circumference, used as a noise-field domain in Experience3D.tsx
  positions: Float32Array[]; // one entry per shape in `shapes`
  outwards: Float32Array[];
  quats: Float32Array[];
  tileWidth: number;
  tileHeight: number;
}

/**
 * Builds a full tile geometry for each shape in `shapes` -- all from
 * the same station/tilesAround/tubeRadius, so every one shares the
 * exact same topology and tile count, index for index -- and flattens
 * each into typed arrays. Experience3D.tsx blends between whichever two
 * are currently adjacent in the journey with a cheap per-tile lerp/
 * slerp, rather than juggling parallel arrays of TileInstance objects
 * or rebuilding geometry on the fly. tileWidth/tileHeight are averaged
 * across all shapes: the box geometry built from them is one shared,
 * unchanging InstancedMesh geometry, not something that resizes as the
 * shape blends.
 */
export function buildTrackGeometrySet(
  shapes: TrackShapeConfig[],
  stationCount: number,
  tilesAround: number,
  tubeRadius: number,
): TrackGeometrySet {
  const built = shapes.map((shape) => buildTrackGeometry(shape, stationCount, tilesAround, tubeRadius));
  const tileCount = built[0].tiles.length;

  const along = new Float32Array(tileCount);
  const ringT = new Float32Array(tileCount);
  for (let i = 0; i < tileCount; i++) {
    along[i] = built[0].tiles[i].along;
    ringT[i] = built[0].tiles[i].ringT;
  }

  const positions = built.map((info) => {
    const arr = new Float32Array(tileCount * 3);
    for (let i = 0; i < tileCount; i++) {
      const p = info.tiles[i].basePosition;
      arr[i * 3] = p.x;
      arr[i * 3 + 1] = p.y;
      arr[i * 3 + 2] = p.z;
    }
    return arr;
  });
  const outwards = built.map((info) => {
    const arr = new Float32Array(tileCount * 3);
    for (let i = 0; i < tileCount; i++) {
      const o = info.tiles[i].outward;
      arr[i * 3] = o.x;
      arr[i * 3 + 1] = o.y;
      arr[i * 3 + 2] = o.z;
    }
    return arr;
  });
  const quats = built.map((info) => {
    const arr = new Float32Array(tileCount * 4);
    for (let i = 0; i < tileCount; i++) {
      const q = info.tiles[i].quaternion;
      arr[i * 4] = q.x;
      arr[i * 4 + 1] = q.y;
      arr[i * 4 + 2] = q.z;
      arr[i * 4 + 3] = q.w;
    }
    return arr;
  });

  const tileWidth = built.reduce((sum, info) => sum + info.tileWidth, 0) / built.length;
  const tileHeight = built.reduce((sum, info) => sum + info.tileHeight, 0) / built.length;

  return { tileCount, along, ringT, positions, outwards, quats, tileWidth, tileHeight };
}
