import * as THREE from "three";

/**
 * The hero's calculus surface "coming online": the same surface
 * geometry as the loading screen's (see createLoadingGraph.ts), but
 * this is a persistent page fixture with its own boot moment, not a
 * looping loading graphic -- so it needs a genuine monochrome-to-color
 * resolve, which the loading screen never does. Kept in a sibling
 * module rather than added to createLoadingGraph.ts so that file (and
 * the loading screen's own boot-free loop) stays untouched.
 *
 * A vertex-colored mesh's final pixel color is material.color times
 * the vertex color -- multiplying by a uniform gray tint changes
 * brightness, not saturation (R, G, and B all get scaled by the same
 * factor), so it can't produce an actual grayscale look on its own.
 * Getting real grayscale means computing each vertex's luminance once
 * and lerping the geometry's live color attribute between that and the
 * original hue-ful colors, frame by frame, while the boot resolves.
 */
export function computeGrayscaleColors(colorAttribute: THREE.BufferAttribute): Float32Array {
  const src = colorAttribute.array as Float32Array;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const luminance = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    out[i] = luminance;
    out[i + 1] = luminance;
    out[i + 2] = luminance;
  }
  return out;
}

/** Writes lerp(from, to, t) into `out`, all three same-length buffers -- reused every frame during the boot resolve rather than allocating a new array each time. */
export function lerpColorBuffers(out: Float32Array, from: Float32Array, to: Float32Array, t: number): void {
  for (let i = 0; i < out.length; i++) {
    out[i] = from[i] + (to[i] - from[i]) * t;
  }
}
