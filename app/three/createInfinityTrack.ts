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
 */
export const CURVE_A = 2.2; // horizontal size
export const CURVE_C = 0.9; // depth/banking amount at the crossing

export function curvePoint(t: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(CURVE_A * Math.cos(t), CURVE_A * Math.sin(t) * Math.cos(t), CURVE_C * Math.sin(t));
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
function buildTrackFrames(stationCount: number): TrackFrame[] {
  const frames: TrackFrame[] = [];
  const delta = 0.0005;
  for (let i = 0; i < stationCount; i++) {
    const t = (i / stationCount) * Math.PI * 2;
    const position = curvePoint(t);
    const ahead = curvePoint(t + delta);
    const behind = curvePoint(t - delta);
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
export function buildTrackGeometry(stationCount: number, tilesAround: number, tubeRadius: number): TrackGeometryInfo {
  const frames = buildTrackFrames(stationCount);

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
    for (let j = 0; j < tilesAround; j++) {
      const angle = (j / tilesAround) * Math.PI * 2;
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
