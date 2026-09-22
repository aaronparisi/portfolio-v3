import * as THREE from "three";

/**
 * The tile-sweep math for the site's original shape -- the chalkboard-
 * era infinity racetrack everything was first tuned against on
 * /infinity-preview (InfinityTrack3D.tsx, which only ever builds this
 * one shape and is otherwise untouched). Experience3D.tsx's own multi-
 * shape morph (see FlatShapeGeometry / buildOrbShape / buildScreenShape
 * further down) blends this against two shapes that AREN'T built this
 * way at all -- see that section's own comment for why.
 *
 * Built from the Lemniscate of Gerono, x = cos t, y = sin t cos t,
 * banked in z by C sin t so the two passes through the shared (x, y)
 * crossing point land at +C and -C -- a genuine 3D "racetrack" that
 * still reads as a flat infinity symbol head-on. Verified numerically
 * at the time (dense sampling + pairwise distance check) that the
 * closest approach anywhere on the loop is nowhere near the crossing,
 * and the crossing itself separates by a full 2*C, comfortably more
 * than twice the tube radius.
 */
export interface TrackShapeConfig {
  curveA: number; // horizontal size
  curveC: number; // depth/banking amount at the crossing
  /** Extra full turns the tile ring's own rotation advances over one
   * lap of the loop -- 0 is the plain, untwisted racetrack. */
  twistTurns: number;
}

export const SHAPE_TEACHER: TrackShapeConfig = { curveA: 2.2, curveC: 0.9, twistTurns: 0 };

export function curvePoint(config: TrackShapeConfig, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(config.curveA * Math.cos(t), config.curveA * Math.sin(t) * Math.cos(t), config.curveC * Math.sin(t));
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
 * violently wherever curvature passes through zero, which this curve
 * does by construction, and a tube built from those frames would show
 * the whole cross-section suddenly twisting there. Each station's
 * normal is instead just the previous station's normal projected into
 * the new tangent's perpendicular plane and renormalized (Gram-Schmidt)
 * -- simpler than a full double-reflection RMF, and produces no visible
 * twist for a smooth closed curve sampled this densely.
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
    // itself -- zero for the untwisted shape, a real spiral otherwise.
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

/**
 * The site's actual shape morph (Experience3D.tsx): three GENUINELY
 * different arrangements, not variations on one "tiles swept around a
 * beam" theme -- a closed loop, a sphere, and a flat grid share no
 * common parametrization at all, so each gets its own dedicated
 * generator instead of all being pushed through the tube-sweep code
 * above. What they DO share is the output shape (flat position/
 * outward/quaternion arrays, one entry per tile, same tile count and
 * index order across all three) -- that's the only thing Experience3D
 * actually needs to blend between them with a cheap per-tile lerp/
 * slerp, same technique as the tube-only version this replaced.
 */
export interface FlatShapeGeometry {
  positions: Float32Array;
  outwards: Float32Array;
  quats: Float32Array;
}

/** Flattens a tube-swept TrackGeometryInfo into the same shape the other two generators produce, so all three can sit side by side in Experience3D's own shape array. */
export function flattenTubeShape(info: TrackGeometryInfo): FlatShapeGeometry {
  const n = info.tiles.length;
  const positions = new Float32Array(n * 3);
  const outwards = new Float32Array(n * 3);
  const quats = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const tile = info.tiles[i];
    positions[i * 3] = tile.basePosition.x;
    positions[i * 3 + 1] = tile.basePosition.y;
    positions[i * 3 + 2] = tile.basePosition.z;
    outwards[i * 3] = tile.outward.x;
    outwards[i * 3 + 1] = tile.outward.y;
    outwards[i * 3 + 2] = tile.outward.z;
    quats[i * 4] = tile.quaternion.x;
    quats[i * 4 + 1] = tile.quaternion.y;
    quats[i * 4 + 2] = tile.quaternion.z;
    quats[i * 4 + 3] = tile.quaternion.w;
  }
  return { positions, outwards, quats };
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * `tileCount` points spread evenly over a sphere (a Fibonacci/"golden
 * spiral" point set -- the standard even-coverage construction: walk
 * latitude linearly from pole to pole, at each step advance longitude
 * by the golden angle, which never lines up into visible meridian
 * bands the way a naive equal-angle grid would). Each tile's outward is
 * just its own radial direction; orientation follows from that alone
 * (no path/tangent to inherit the way the tube-swept shape has one).
 * The "data orb" mid-journey shape -- the loop visibly breaking apart
 * and condensing into something else entirely, not just re-tuned.
 */
export function buildOrbShape(tileCount: number, radius: number): FlatShapeGeometry {
  const positions = new Float32Array(tileCount * 3);
  const outwards = new Float32Array(tileCount * 3);
  const quats = new Float32Array(tileCount * 4);

  const worldUp = new THREE.Vector3(0, 1, 0);
  const altSeed = new THREE.Vector3(1, 0, 0);
  const tileZ = new THREE.Vector3();
  const tileX = new THREE.Vector3();
  const tileY = new THREE.Vector3();
  const basisMatrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();

  for (let i = 0; i < tileCount; i++) {
    const yFrac = tileCount > 1 ? 1 - (i / (tileCount - 1)) * 2 : 0; // 1..-1, pole to pole
    const radiusAtY = Math.sqrt(Math.max(0, 1 - yFrac * yFrac));
    const theta = GOLDEN_ANGLE * i;
    const px = Math.cos(theta) * radiusAtY * radius;
    const py = yFrac * radius;
    const pz = Math.sin(theta) * radiusAtY * radius;
    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;

    tileZ.set(px, py, pz).normalize();
    outwards[i * 3] = tileZ.x;
    outwards[i * 3 + 1] = tileZ.y;
    outwards[i * 3 + 2] = tileZ.z;

    const seed = Math.abs(tileZ.dot(worldUp)) > 0.99 ? altSeed : worldUp;
    tileX.crossVectors(seed, tileZ).normalize();
    tileY.crossVectors(tileZ, tileX);
    basisMatrix.makeBasis(tileX, tileY, tileZ);
    quaternion.setFromRotationMatrix(basisMatrix);
    quats[i * 4] = quaternion.x;
    quats[i * 4 + 1] = quaternion.y;
    quats[i * 4 + 2] = quaternion.z;
    quats[i * 4 + 3] = quaternion.w;
  }

  return { positions, outwards, quats };
}

/**
 * `tileCount` tiles arranged in a flat `cols`-wide grid -- a screen
 * made of tiles instead of a loop tracing a screen's outline (the
 * earlier attempt at a "terminal" shape, before this rework: a rounded-
 * rectangle loop, which was really just another variation on "tiles
 * swept around a beam"). Every tile faces the same way (+z, world
 * space) since there's no curved surface to follow -- lifting toward
 * the viewer reads as a pixel breaking free of the screen.
 * `tileCount` is expected to divide evenly by `cols` (it does for the
 * counts this file's callers actually use); any remainder just lands in
 * a final partial row rather than being dropped.
 */
export function buildScreenShape(tileCount: number, cols: number, spacing: number): FlatShapeGeometry {
  const rows = Math.ceil(tileCount / cols);
  const positions = new Float32Array(tileCount * 3);
  const outwards = new Float32Array(tileCount * 3);
  const quats = new Float32Array(tileCount * 4);
  // Identity orientation: local +Z (the tile's own thickness axis) is
  // already world +Z, local +X/+Y already the grid's own row/column
  // axes -- no basis construction needed here at all.
  for (let i = 0; i < tileCount; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = (col - (cols - 1) / 2) * spacing;
    const y = ((rows - 1) / 2 - row) * spacing; // row 0 at the top
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = 0;
    outwards[i * 3] = 0;
    outwards[i * 3 + 1] = 0;
    outwards[i * 3 + 2] = 1;
    quats[i * 4] = 0;
    quats[i * 4 + 1] = 0;
    quats[i * 4 + 2] = 0;
    quats[i * 4 + 3] = 1;
  }
  return { positions, outwards, quats };
}

/**
 * Every tile's fixed (along-the-loop, around-the-tube) coordinate,
 * derived directly from the tube-sweep's own station/ring indexing --
 * used as the noise-field domain in Experience3D.tsx for every shape,
 * not just the tube one. That's intentional, not a shortcut: since tile
 * index order (and therefore which UV each index owns) never changes
 * across the whole shape morph, whatever subset of the 2600 tiles reads
 * as "one coherent patch" under the noise field stays the SAME set of
 * tiles no matter which shape currently holds them -- a consistent
 * identity for "this neighborhood" through the whole transformation,
 * even though the neighborhood's actual position keeps changing.
 */
export function buildTileUV(stationCount: number, tilesAround: number): { along: Float32Array; ringT: Float32Array } {
  const tileCount = stationCount * tilesAround;
  const along = new Float32Array(tileCount);
  const ringT = new Float32Array(tileCount);
  for (let i = 0; i < stationCount; i++) {
    for (let j = 0; j < tilesAround; j++) {
      const idx = i * tilesAround + j;
      along[idx] = i / stationCount;
      ringT[idx] = j / tilesAround;
    }
  }
  return { along, ringT };
}
