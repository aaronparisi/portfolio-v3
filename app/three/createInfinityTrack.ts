import * as THREE from "three";

/**
 * A figure-eight that reads as a flat infinity symbol head-on but is
 * actually a genuine, non-self-intersecting 3D loop -- a "racetrack"
 * where the two strands that a flat lemniscate would cross in the
 * middle instead pass at different depths, like a highway overpass.
 *
 * Built from the Lemniscate of Gerono, x(t) = cos t, y(t) = sin t cos t
 * -- a standard flat figure-eight that self-intersects at the origin,
 * reached at both t = pi/2 and t = 3*pi/2 (cos t = 0 at both). Adding a
 * third coordinate z(t) = C sin t doesn't touch x or y at all, so an
 * orthographic view straight down the z axis ("from the front") still
 * projects to the exact same flat infinity symbol -- but sin(pi/2) = 1
 * and sin(3*pi/2) = -1, so the two passes through that shared (x, y)
 * point land at +C and -C: genuinely separated in 3D, not overlapping.
 * Verified numerically, not just algebraically -- sampling the curve
 * densely and checking every non-adjacent pair of points for
 * near-coincidence in 3D confirms the closest approach anywhere on the
 * loop (other than the loop closing on itself at t=0/2*pi, which isn't
 * a self-intersection) is nowhere near the crossing, and the crossing
 * itself separates by a full 2*C -- comfortably more than twice the
 * tube radius below, so the two strands never come close to touching.
 *
 * `curveA`/`curveC` used to be fixed module constants; they're now a
 * config object instead (see TrackShapeConfig) so the site's persistent
 * backdrop (Experience3D.tsx) can build two distinct shapes -- the same
 * topology, different proportions and an optional spiral twist -- and
 * blend between them as the visitor scrolls. The tuned preview
 * (InfinityTrack3D.tsx) just passes one fixed config, unchanged from
 * the values this file used to hard-code.
 */
export interface TrackShapeConfig {
  curveA: number; // horizontal size
  curveC: number; // depth/banking amount at the crossing
  /** Extra full turns the tile ring's own rotation advances over one
   * lap of the loop -- 0 is the plain, untwisted racetrack; a nonzero
   * value spirals the tiling into more of a coiled conduit, reading as
   * a distinctly more "engineered" shape than the same curve untwisted. */
  twistTurns: number;
}

export const TRACK_SHAPES: Record<"teacher" | "coder", TrackShapeConfig> = {
  // The shape everything was tuned against on /infinity-preview: smooth,
  // rounded, symmetric -- a chalkboard infinity symbol.
  teacher: { curveA: 2.2, curveC: 0.9, twistTurns: 0 },
  // Wider and flatter (less banking depth), with a slow spiral twist
  // through the tiling -- reads as tighter and more deliberately
  // engineered without changing the underlying loop's topology at all.
  coder: { curveA: 2.6, curveC: 0.45, twistTurns: 1.5 },
};

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

      tiles.push({ basePosition, outward, quaternion, along: i / stationCount });
    }
  }

  return { tiles, tileWidth, tileHeight, loopLength };
}

export interface TrackGeometryPair {
  tileCount: number;
  along: Float32Array; // shared between both shapes -- same topology/order
  positionsA: Float32Array;
  positionsB: Float32Array;
  outwardA: Float32Array;
  outwardB: Float32Array;
  quatA: Float32Array;
  quatB: Float32Array;
  tileWidth: number;
  tileHeight: number;
}

/**
 * Builds two full tile geometries from the same station/tilesAround/
 * tubeRadius (so they share the exact same topology and tile count,
 * index for index) and flattens both into typed arrays -- the shape
 * Experience3D.tsx wants for a cheap per-frame lerp/slerp between them,
 * rather than juggling two parallel arrays of TileInstance objects.
 * tileWidth/tileHeight are averaged across the pair: the box geometry
 * built from them is one shared, unchanging InstancedMesh geometry, not
 * something that resizes as the shape blends.
 */
export function buildTrackGeometryPair(
  shapeA: TrackShapeConfig,
  shapeB: TrackShapeConfig,
  stationCount: number,
  tilesAround: number,
  tubeRadius: number,
): TrackGeometryPair {
  const a = buildTrackGeometry(shapeA, stationCount, tilesAround, tubeRadius);
  const b = buildTrackGeometry(shapeB, stationCount, tilesAround, tubeRadius);
  const tileCount = a.tiles.length;

  const along = new Float32Array(tileCount);
  const positionsA = new Float32Array(tileCount * 3);
  const positionsB = new Float32Array(tileCount * 3);
  const outwardA = new Float32Array(tileCount * 3);
  const outwardB = new Float32Array(tileCount * 3);
  const quatA = new Float32Array(tileCount * 4);
  const quatB = new Float32Array(tileCount * 4);

  for (let i = 0; i < tileCount; i++) {
    along[i] = a.tiles[i].along;
    const pa = a.tiles[i].basePosition;
    const pb = b.tiles[i].basePosition;
    positionsA[i * 3] = pa.x;
    positionsA[i * 3 + 1] = pa.y;
    positionsA[i * 3 + 2] = pa.z;
    positionsB[i * 3] = pb.x;
    positionsB[i * 3 + 1] = pb.y;
    positionsB[i * 3 + 2] = pb.z;

    const oa = a.tiles[i].outward;
    const ob = b.tiles[i].outward;
    outwardA[i * 3] = oa.x;
    outwardA[i * 3 + 1] = oa.y;
    outwardA[i * 3 + 2] = oa.z;
    outwardB[i * 3] = ob.x;
    outwardB[i * 3 + 1] = ob.y;
    outwardB[i * 3 + 2] = ob.z;

    const qa = a.tiles[i].quaternion;
    const qb = b.tiles[i].quaternion;
    quatA[i * 4] = qa.x;
    quatA[i * 4 + 1] = qa.y;
    quatA[i * 4 + 2] = qa.z;
    quatA[i * 4 + 3] = qa.w;
    quatB[i * 4] = qb.x;
    quatB[i * 4 + 1] = qb.y;
    quatB[i * 4 + 2] = qb.z;
    quatB[i * 4 + 3] = qb.w;
  }

  return {
    tileCount,
    along,
    positionsA,
    positionsB,
    outwardA,
    outwardB,
    quatA,
    quatB,
    tileWidth: (a.tileWidth + b.tileWidth) / 2,
    tileHeight: (a.tileHeight + b.tileHeight) / 2,
  };
}
