import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

type TaperedStation = { position: [number, number, number]; rx: number; rz: number; twist?: number };

// Frames come from PARALLEL TRANSPORT, not from a Frenet frame. A Frenet frame is defined by
// the curve's normal, which flips sign wherever the path has an inflection or straightens out,
// and every flip twists the surface 180 degrees within one segment. Carrying the previous frame
// forward and removing only its along-path component keeps the twist continuous. THREE's own
// extrudePath and TubeGeometry do not expose this, which is why this is hand-built.
function buildTaperedSweepGeometry(
  sweep: { stations: TaperedStation[]; radialSegments?: number; capEnds?: boolean },
): THREE.BufferGeometry {
  const stations = sweep.stations;
  if (stations.length < 2) throw new Error('tapered-sweep needs at least two stations');
  const radial = Math.max(3, sweep.radialSegments ?? 10);
  const centres = stations.map((s) => new THREE.Vector3(...s.position));

  const tangents = centres.map((_, i) => {
    const prev = centres[Math.max(0, i - 1)];
    const next = centres[Math.min(centres.length - 1, i + 1)];
    const t = next.clone().sub(prev);
    // Coincident neighbours would normalise to NaN and poison every downstream vertex.
    return t.lengthSq() < 1e-12 ? new THREE.Vector3(0, 1, 0) : t.normalize();
  });

  // Seed a reference axis that is not parallel to the first tangent, or the first cross
  // product is degenerate and the whole sweep collapses to a line.
  let ref = new THREE.Vector3(0, 0, 1);
  if (Math.abs(tangents[0].dot(ref)) > 0.9) ref = new THREE.Vector3(1, 0, 0);

  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];
  let carried = ref.clone().sub(tangents[0].clone().multiplyScalar(ref.dot(tangents[0]))).normalize();
  for (let i = 0; i < tangents.length; i += 1) {
    const t = tangents[i];
    // Project the carried frame back onto the plane perpendicular to this tangent.
    const n = carried.clone().sub(t.clone().multiplyScalar(carried.dot(t)));
    if (n.lengthSq() < 1e-12) {
      const fallback = Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      n.copy(fallback.sub(t.clone().multiplyScalar(fallback.dot(t))));
    }
    n.normalize();
    normals.push(n);
    binormals.push(new THREE.Vector3().crossVectors(t, n).normalize());
    carried = n;
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringStart: number[] = [];
  const isPoint: boolean[] = [];

  for (let i = 0; i < stations.length; i += 1) {
    const st = stations[i];
    const v = i / (stations.length - 1);
    ringStart.push(positions.length / 3);
    // A station whose section has collapsed emits ONE vertex, not a ring of radius zero.
    // A degenerate ring still carries `radial` coincident vertices and `radial` zero-area
    // triangles, so the lock ends in a blunt cap the width of the floating-point noise
    // rather than at a point -- and a hair lock, a horn or a blade tip has to reach a point.
    if (st.rx <= 1e-6 && st.rz <= 1e-6) {
      isPoint.push(true);
      positions.push(centres[i].x, centres[i].y, centres[i].z);
      uvs.push(0.5, v);
      continue;
    }
    isPoint.push(false);
    const twist = ((st.twist ?? 0) * Math.PI) / 180;
    for (let j = 0; j <= radial; j += 1) {
      const theta = (j / radial) * Math.PI * 2 + twist;
      const offset = normals[i].clone().multiplyScalar(Math.cos(theta) * st.rx)
        .add(binormals[i].clone().multiplyScalar(Math.sin(theta) * st.rz));
      const p = centres[i].clone().add(offset);
      positions.push(p.x, p.y, p.z);
      uvs.push(j / radial, v);
    }
  }

  for (let i = 0; i < stations.length - 1; i += 1) {
    const a0 = ringStart[i];
    const b0 = ringStart[i + 1];
    if (isPoint[i] && isPoint[i + 1]) continue;   // two collapsed stations bound nothing
    for (let j = 0; j < radial; j += 1) {
      // Wound so the face normal points radially OUTWARD.
      //
      // Ring vertices advance from `normal` toward `binormal`, and binormal is
      // tangent x normal, so increasing theta runs counter-clockwise seen from the
      // far end of the segment. Taking the ring-to-ring edge first therefore puts
      // the cross product on the inside. Measured as signed volume on the built
      // mesh: every tapered-sweep came out negative -- a torso at -0.0674 and a
      // tail at -0.0044 against a positive ellipsoid head -- so every sweep this
      // generator has ever emitted rendered its back faces, with normals pointing
      // into the solid and every lighting judgement made on the wrong surface.
      if (isPoint[i]) indices.push(a0, b0 + j + 1, b0 + j);
      else if (isPoint[i + 1]) indices.push(a0 + j, a0 + j + 1, b0);
      else indices.push(a0 + j, a0 + j + 1, b0 + j, a0 + j + 1, b0 + j + 1, b0 + j);
    }
  }

  if (sweep.capEnds ?? true) {
    for (const end of [0, stations.length - 1]) {
      if (isPoint[end]) continue;   // a point end is already closed
      const centreIndex = positions.length / 3;
      positions.push(centres[end].x, centres[end].y, centres[end].z);
      uvs.push(0.5, end === 0 ? 0 : 1);
      const base = ringStart[end];
      for (let j = 0; j < radial; j += 1) {
        if (end === 0) indices.push(centreIndex, base + j + 1, base + j);
        else indices.push(centreIndex, base + j, base + j + 1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Aaron faceted bust
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createAaronFacetedBustModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Aaron faceted bust";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["skin"] = createSculptMaterial(
    "skin",
    {"id": "skin", "name": "Skin", "type": "standard", "shaderModel": "MeshStandardMaterial, flatShading:true", "baseColor": "#e8bc78", "color": "#e8bc78", "albedo": {"dominant": "#e8bc78", "secondary": [], "samplingNotes": "Color drawn from the site's own acetate-plane palette (app/app.css / scripts/generate-hero-planes.mjs), not the photo's literal color -- see objectClass.notes."}, "colorVariation": {"palette": ["#e8bc78"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 64, "textureProjection": {"mode": "none", "repeat": [1.0, 1.0], "anisotropy": 1, "texelDensityIntent": "no texture -- flat vertex-color/material color only"}, "surfaceFrequencyBands": [], "roughness": {"base": 0.6, "variation": 0.1, "map": "none", "localResponse": "very slightly lower roughness (subtler sheen) at the nose bridge and forehead facets, matching the source photo's own highlight placement (image-analysis.md Layer 6)."}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "none -- flat faceted material"}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "stubble", "region": "jaw/upper-lip facets", "effect": "roughness +0.15 (matte, not glossy)", "evidenceRef": "faceplate-zone"}], "shaderNotes": ["flatShading:true is load-bearing -- the facets are the entire surface language.", "No texture maps of any kind; MeshStandardMaterial with a flat color + roughness/metalness only."], "notes": "Deliberately flat, no procedural surface texture: this is a faceted low-poly material -- shading variation comes from real-time lighting hitting flat per-face normals (flatShading:true), not from a painted macro/meso/micro noise stack. Matches the hero portrait's own flat acetate-plane treatment. Amber (--accent) reused directly as skin tone -- the lightest, warmest palette color, and the same one the hero portrait's own highlight plane uses for skin."},
    options
  );
  materialMap["hair"] = createSculptMaterial(
    "hair",
    {"id": "hair", "name": "Hair", "type": "standard", "shaderModel": "MeshStandardMaterial, flatShading:true", "baseColor": "#a85c3a", "color": "#a85c3a", "albedo": {"dominant": "#a85c3a", "secondary": [], "samplingNotes": "Color drawn from the site's own acetate-plane palette (app/app.css / scripts/generate-hero-planes.mjs), not the photo's literal color -- see objectClass.notes."}, "colorVariation": {"palette": ["#a85c3a"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 64, "textureProjection": {"mode": "none", "repeat": [1.0, 1.0], "anisotropy": 1, "texelDensityIntent": "no texture -- flat vertex-color/material color only"}, "surfaceFrequencyBands": [], "roughness": {"base": 0.8, "variation": 0.1, "map": "none", "localResponse": "crown-facing facets slightly lower roughness than underside facets, echoing the photo's backlit-crown rim highlight."}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "none -- flat faceted material"}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "hair-part-volume", "region": "proper-left clump cluster", "effect": "scaled 1.08x vs. the mirrored proper-right clumps -- the measured silhouette asymmetry", "evidenceRef": "hairMass-zone"}], "shaderNotes": ["flatShading:true is load-bearing -- the facets are the entire surface language.", "No texture maps of any kind; MeshStandardMaterial with a flat color + roughness/metalness only."], "notes": "Deliberately flat, no procedural surface texture: this is a faceted low-poly material -- shading variation comes from real-time lighting hitting flat per-face normals (flatShading:true), not from a painted macro/meso/micro noise stack. Matches the hero portrait's own flat acetate-plane treatment. Sienna (--accent-warm) -- a plausible warm dark-brown hair read, distinct in value from the amber skin. Stylized clump masses (reconstruction.md), never strand geometry."},
    options
  );
  materialMap["hoodieFleece"] = createSculptMaterial(
    "hoodieFleece",
    {"id": "hoodieFleece", "name": "Hoodie fleece", "type": "standard", "shaderModel": "MeshStandardMaterial, flatShading:true", "baseColor": "#2a264a", "color": "#2a264a", "albedo": {"dominant": "#2a264a", "secondary": [], "samplingNotes": "Color drawn from the site's own acetate-plane palette (app/app.css / scripts/generate-hero-planes.mjs), not the photo's literal color -- see objectClass.notes."}, "colorVariation": {"palette": ["#2a264a"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 64, "textureProjection": {"mode": "none", "repeat": [1.0, 1.0], "anisotropy": 1, "texelDensityIntent": "no texture -- flat vertex-color/material color only"}, "surfaceFrequencyBands": [], "roughness": {"base": 0.95, "variation": 0.05, "map": "none", "localResponse": "very high, near-uniform roughness (napped fleece) with a slightly lower value at the fold-cluster facets where fabric doubles over itself."}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "none -- flat faceted material"}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "fabric-fold-cluster", "region": "chest/underarm facets", "effect": "extra edge facets at the fold zone rather than a flat panel -- geometry-level relief, not a texture", "evidenceRef": "torsoPanel-zone"}], "shaderNotes": ["flatShading:true is load-bearing -- the facets are the entire surface language.", "No texture maps of any kind; MeshStandardMaterial with a flat color + roughness/metalness only."], "notes": "Deliberately flat, no procedural surface texture: this is a faceted low-poly material -- shading variation comes from real-time lighting hitting flat per-face normals (flatShading:true), not from a painted macro/meso/micro noise stack. Matches the hero portrait's own flat acetate-plane treatment. Indigo (the portrait's shadow plane) -- the darkest palette color, matching the real garment being the darkest thing in the source photo even though the hue itself (indigo, not the real wine/aubergine) is a deliberate palette-lock substitution."},
    options
  );
  materialMap["henleyKnit"] = createSculptMaterial(
    "henleyKnit",
    {"id": "henleyKnit", "name": "Henley collar knit", "type": "standard", "shaderModel": "MeshStandardMaterial, flatShading:true", "baseColor": "#14100e", "color": "#14100e", "albedo": {"dominant": "#14100e", "secondary": [], "samplingNotes": "Color drawn from the site's own acetate-plane palette (app/app.css / scripts/generate-hero-planes.mjs), not the photo's literal color -- see objectClass.notes."}, "colorVariation": {"palette": ["#14100e"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 64, "textureProjection": {"mode": "none", "repeat": [1.0, 1.0], "anisotropy": 1, "texelDensityIntent": "no texture -- flat vertex-color/material color only"}, "surfaceFrequencyBands": [], "roughness": {"base": 0.5, "variation": 0.0, "map": "none", "localResponse": "none"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "none -- flat faceted material"}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["flatShading:true is load-bearing -- the facets are the entire surface language.", "No texture maps of any kind; MeshStandardMaterial with a flat color + roughness/metalness only."], "notes": "Deliberately flat, no procedural surface texture: this is a faceted low-poly material -- shading variation comes from real-time lighting hitting flat per-face normals (flatShading:true), not from a painted macro/meso/micro noise stack. Matches the hero portrait's own flat acetate-plane treatment. Ink -- distinguished from the indigo hoodie by a lower roughness (subtler sheen) rather than a different hue, keeping the whole model inside the same four-color family."},
    options
  );
  materialMap["metal"] = createSculptMaterial(
    "metal",
    {"id": "metal", "name": "Zipper / earring metal", "type": "standard", "shaderModel": "MeshStandardMaterial, flatShading:true", "baseColor": "#14100e", "color": "#14100e", "albedo": {"dominant": "#14100e", "secondary": [], "samplingNotes": "Color drawn from the site's own acetate-plane palette (app/app.css / scripts/generate-hero-planes.mjs), not the photo's literal color -- see objectClass.notes."}, "colorVariation": {"palette": ["#14100e"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 64, "textureProjection": {"mode": "none", "repeat": [1.0, 1.0], "anisotropy": 1, "texelDensityIntent": "no texture -- flat vertex-color/material color only"}, "surfaceFrequencyBands": [], "roughness": {"base": 0.3, "variation": 0.0, "map": "none", "localResponse": "none"}, "metalness": {"base": 1.0, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "none -- flat faceted material"}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["flatShading:true is load-bearing -- the facets are the entire surface language.", "No texture maps of any kind; MeshStandardMaterial with a flat color + roughness/metalness only."], "notes": "Deliberately flat, no procedural surface texture: this is a faceted low-poly material -- shading variation comes from real-time lighting hitting flat per-face normals (flatShading:true), not from a painted macro/meso/micro noise stack. Matches the hero portrait's own flat acetate-plane treatment. Same ink base color as the henley, but metalness:1 + low roughness reads as brushed metal under real lighting -- same hue, completely different material response, standard PBR practice."},
    options
  );
  materialMap["cord"] = createSculptMaterial(
    "cord",
    {"id": "cord", "name": "Drawstring cord", "type": "standard", "shaderModel": "MeshStandardMaterial, flatShading:true", "baseColor": "#e8bc78", "color": "#e8bc78", "albedo": {"dominant": "#e8bc78", "secondary": [], "samplingNotes": "Color drawn from the site's own acetate-plane palette (app/app.css / scripts/generate-hero-planes.mjs), not the photo's literal color -- see objectClass.notes."}, "colorVariation": {"palette": ["#e8bc78"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 64, "textureProjection": {"mode": "none", "repeat": [1.0, 1.0], "anisotropy": 1, "texelDensityIntent": "no texture -- flat vertex-color/material color only"}, "surfaceFrequencyBands": [], "roughness": {"base": 0.7, "variation": 0.0, "map": "none", "localResponse": "none"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "none -- flat faceted material"}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["flatShading:true is load-bearing -- the facets are the entire surface language.", "No texture maps of any kind; MeshStandardMaterial with a flat color + roughness/metalness only."], "notes": "Deliberately flat, no procedural surface texture: this is a faceted low-poly material -- shading variation comes from real-time lighting hitting flat per-face normals (flatShading:true), not from a painted macro/meso/micro noise stack. Matches the hero portrait's own flat acetate-plane treatment. Amber again (lightest palette color) so the drawstrings pop against the indigo hoodie the way the real white cord popped against the real dark fleece."},
    options
  );
  materialMap["eye"] = createSculptMaterial(
    "eye",
    {"id": "eye", "name": "Eye (sclera + iris + catchlight)", "type": "standard", "shaderModel": "MeshStandardMaterial, flatShading:true", "baseColor": "#f3ece0", "color": "#f3ece0", "albedo": {"dominant": "#f3ece0", "secondary": [], "samplingNotes": "Color drawn from the site's own acetate-plane palette (app/app.css / scripts/generate-hero-planes.mjs), not the photo's literal color -- see objectClass.notes."}, "colorVariation": {"palette": ["#f3ece0"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 64, "textureProjection": {"mode": "none", "repeat": [1.0, 1.0], "anisotropy": 1, "texelDensityIntent": "no texture -- flat vertex-color/material color only"}, "surfaceFrequencyBands": [], "roughness": {"base": 0.15, "variation": 0.0, "map": "none", "localResponse": "none"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "none -- flat faceted material"}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "catchlight", "region": "iris facet facing the key light", "effect": "small emissive-white facet, offset toward lightingFromPhoto's key direction", "evidenceRef": "faceplate-zone"}], "shaderNotes": ["flatShading:true is load-bearing -- the facets are the entire surface language.", "No texture maps of any kind; MeshStandardMaterial with a flat color + roughness/metalness only."], "notes": "Deliberately flat, no procedural surface texture: this is a faceted low-poly material -- shading variation comes from real-time lighting hitting flat per-face normals (flatShading:true), not from a painted macro/meso/micro noise stack. Matches the hero portrait's own flat acetate-plane treatment. Off-white sclera (site's --ink token) with a low roughness for the glossy-sphere-plus-catchlight treatment reconstruction.md calls for; iris/catchlight are separate small child meshes, not a texture."},
    options
  );
  materialMap["hidden"] = createSculptMaterial(
    "hidden",
    {"id": "hidden", "name": "Hidden (root/group only)", "type": "standard", "shaderModel": "MeshStandardMaterial, flatShading:true", "baseColor": "#000000", "color": "#000000", "albedo": {"dominant": "#000000", "secondary": [], "samplingNotes": "Color drawn from the site's own acetate-plane palette (app/app.css / scripts/generate-hero-planes.mjs), not the photo's literal color -- see objectClass.notes."}, "colorVariation": {"palette": ["#000000"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 64, "textureProjection": {"mode": "none", "repeat": [1.0, 1.0], "anisotropy": 1, "texelDensityIntent": "no texture -- flat vertex-color/material color only"}, "surfaceFrequencyBands": [], "roughness": {"base": 1.0, "variation": 0.0, "map": "none", "localResponse": "none"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "none -- flat faceted material"}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["flatShading:true is load-bearing -- the facets are the entire surface language.", "No texture maps of any kind; MeshStandardMaterial with a flat color + roughness/metalness only."], "notes": "Not rendered -- root is an empty THREE.Group, never a visible mesh."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Bust (root)__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Bust (root)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Bust (root) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": null, "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Bust (root)";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Bust (root)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Bust (root) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": null, "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_torso_1 = makeAttachmentEndpoint(null);
  const node_torso_1 = new THREE.Group();
  node_torso_1.name = "Upper torso (hoodie)__pivot";
  node_torso_1.scale.set(1, 1, 1);
  if (endpoint_torso_1) {
    node_torso_1.position.copy(endpoint_torso_1.start);
    node_torso_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_torso_1.position.set(0.0, -0.89, 0.0);
    node_torso_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_torso_1.userData.sculptComponent = {"id": "torso", "name": "Upper torso (hoodie)", "level": "macro", "role": "body", "importance": 0.95, "confidence": 0.85, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "Torso is a tapered-sweep measured directly from the reference photo's alpha silhouette at 7 height slices (see .img2threejs/image-analysis.md and the measure-widths capture): narrow at the shoulder/neck junction, widening toward the crop as the arms held at the sides bulk out the hoodie, with a slight pinch at the very bottom where the hands come together -- not a guessed realistic-body taper.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away", "taperedSweep": {"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.4163, "rz": 0.20815, "twist": 0.0}, {"position": [0.0, -0.26, 0.0], "rx": 0.4946, "rz": 0.2473, "twist": 0.0}, {"position": [0.0, -0.09, 0.0], "rx": 0.4656, "rz": 0.2328, "twist": 0.0}, {"position": [0.0, 0.07, 0.0], "rx": 0.4319, "rz": 0.21595, "twist": 0.0}, {"position": [0.0, 0.24, 0.0], "rx": 0.3957, "rz": 0.19785, "twist": 0.0}, {"position": [0.0, 0.4, 0.0], "rx": 0.3244, "rz": 0.1622, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.1857, "rz": 0.09285, "twist": 0.0}], "radialSegments": 10, "capEnds": true}}, "parent": "root", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 2.7, "height": 1.78, "depth": 1.35, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, -0.89, 0], "rotation": [0, 0, 0], "scale": [2.7, 1.78, 1.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "torso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hoodieFleece", "materialLayers": ["hoodieFleece"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["chest/underarm fold cluster (soft large-scale wrinkles)", "tapers from shoulder width to a narrower crop-bottom width"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "torsoPanel-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 38, 74, 1.0)", "secondaryAlbedo": "rgba(25, 22, 44, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_torso_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "torso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_torso_1);
  nodes["torso"] = node_torso_1;
  const mesh_torso_1Geometry = endpoint_torso_1
    ? new THREE.CylinderGeometry(endpoint_torso_1.endRadius, endpoint_torso_1.baseRadius, endpoint_torso_1.length, 32, 12)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.4163, "rz": 0.20815, "twist": 0.0}, {"position": [0.0, -0.26, 0.0], "rx": 0.4946, "rz": 0.2473, "twist": 0.0}, {"position": [0.0, -0.09, 0.0], "rx": 0.4656, "rz": 0.2328, "twist": 0.0}, {"position": [0.0, 0.07, 0.0], "rx": 0.4319, "rz": 0.21595, "twist": 0.0}, {"position": [0.0, 0.24, 0.0], "rx": 0.3957, "rz": 0.19785, "twist": 0.0}, {"position": [0.0, 0.4, 0.0], "rx": 0.3244, "rz": 0.1622, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.1857, "rz": 0.09285, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_torso_1) {
    mesh_torso_1Geometry.scale(2.7, 1.78, 1.35);
  }
  const mesh_torso_1 = new THREE.Mesh(
    mesh_torso_1Geometry,
    materialMap["hoodieFleece"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_torso_1.name = "Upper torso (hoodie)";
  if (endpoint_torso_1) {
    mesh_torso_1.position.copy(endpoint_torso_1.midpoint);
    mesh_torso_1.quaternion.copy(endpoint_torso_1.quaternion);
  }
  mesh_torso_1.castShadow = options.castShadow ?? true;
  mesh_torso_1.receiveShadow = options.receiveShadow ?? true;
  mesh_torso_1.userData.sculptComponent = {"id": "torso", "name": "Upper torso (hoodie)", "level": "macro", "role": "body", "importance": 0.95, "confidence": 0.85, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "Torso is a tapered-sweep measured directly from the reference photo's alpha silhouette at 7 height slices (see .img2threejs/image-analysis.md and the measure-widths capture): narrow at the shoulder/neck junction, widening toward the crop as the arms held at the sides bulk out the hoodie, with a slight pinch at the very bottom where the hands come together -- not a guessed realistic-body taper.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away", "taperedSweep": {"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.4163, "rz": 0.20815, "twist": 0.0}, {"position": [0.0, -0.26, 0.0], "rx": 0.4946, "rz": 0.2473, "twist": 0.0}, {"position": [0.0, -0.09, 0.0], "rx": 0.4656, "rz": 0.2328, "twist": 0.0}, {"position": [0.0, 0.07, 0.0], "rx": 0.4319, "rz": 0.21595, "twist": 0.0}, {"position": [0.0, 0.24, 0.0], "rx": 0.3957, "rz": 0.19785, "twist": 0.0}, {"position": [0.0, 0.4, 0.0], "rx": 0.3244, "rz": 0.1622, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.1857, "rz": 0.09285, "twist": 0.0}], "radialSegments": 10, "capEnds": true}}, "parent": "root", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 2.7, "height": 1.78, "depth": 1.35, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, -0.89, 0], "rotation": [0, 0, 0], "scale": [2.7, 1.78, 1.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "torso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hoodieFleece", "materialLayers": ["hoodieFleece"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["chest/underarm fold cluster (soft large-scale wrinkles)", "tapers from shoulder width to a narrower crop-bottom width"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "torsoPanel-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 38, 74, 1.0)", "secondaryAlbedo": "rgba(25, 22, 44, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_torso_1.add(mesh_torso_1);
  meshes["torso"] = mesh_torso_1;
  colliders["torso"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["torso"] ??= [];
  destructionGroups["torso"].push(node_torso_1);

  const endpoint_hood_2 = makeAttachmentEndpoint(null);
  const node_hood_2 = new THREE.Group();
  node_hood_2.name = "Hood (folded down)__pivot";
  node_hood_2.scale.set(1, 1, 1);
  if (endpoint_hood_2) {
    node_hood_2.position.copy(endpoint_hood_2.start);
    node_hood_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_hood_2.position.set(0.0, 0.7475999999999999, -0.37537499999999996);
    node_hood_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_hood_2.userData.sculptComponent = {"id": "hood", "name": "Hood (folded down)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Hood (folded down) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "torso", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.975, "height": 0.28, "depth": 0.32, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.7475999999999999, -0.37537499999999996], "rotation": [0, 0, 0], "scale": [0.975, 0.28, 0.32]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hood", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hoodieFleece", "materialLayers": ["hoodieFleece"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["draped/resting on shoulders and upper back, not worn up"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "hood-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 38, 74, 1.0)", "secondaryAlbedo": "rgba(25, 22, 44, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_hood_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hood", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["torso"] ?? root).add(node_hood_2);
  nodes["hood"] = node_hood_2;
  const mesh_hood_2Geometry = endpoint_hood_2
    ? new THREE.CylinderGeometry(endpoint_hood_2.endRadius, endpoint_hood_2.baseRadius, endpoint_hood_2.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_hood_2) {
    mesh_hood_2Geometry.scale(0.975, 0.28, 0.32);
  }
  const mesh_hood_2 = new THREE.Mesh(
    mesh_hood_2Geometry,
    materialMap["hoodieFleece"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hood_2.name = "Hood (folded down)";
  if (endpoint_hood_2) {
    mesh_hood_2.position.copy(endpoint_hood_2.midpoint);
    mesh_hood_2.quaternion.copy(endpoint_hood_2.quaternion);
  }
  mesh_hood_2.castShadow = options.castShadow ?? true;
  mesh_hood_2.receiveShadow = options.receiveShadow ?? true;
  mesh_hood_2.userData.sculptComponent = {"id": "hood", "name": "Hood (folded down)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Hood (folded down) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "torso", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.975, "height": 0.28, "depth": 0.32, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.7475999999999999, -0.37537499999999996], "rotation": [0, 0, 0], "scale": [0.975, 0.28, 0.32]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hood", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hoodieFleece", "materialLayers": ["hoodieFleece"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["draped/resting on shoulders and upper back, not worn up"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "hood-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 38, 74, 1.0)", "secondaryAlbedo": "rgba(25, 22, 44, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_hood_2.add(mesh_hood_2);
  meshes["hood"] = mesh_hood_2;
  colliders["hood"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["hood"] ??= [];
  destructionGroups["hood"].push(node_hood_2);

  const endpoint_zipperTrack_3 = makeAttachmentEndpoint(null);
  const node_zipperTrack_3 = new THREE.Group();
  node_zipperTrack_3.name = "Zipper (unzipped to mid-chest)__pivot";
  node_zipperTrack_3.scale.set(1, 1, 1);
  if (endpoint_zipperTrack_3) {
    node_zipperTrack_3.position.copy(endpoint_zipperTrack_3.start);
    node_zipperTrack_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_zipperTrack_3.position.set(0.0, 0.267, 0.53625);
    node_zipperTrack_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_zipperTrack_3.userData.sculptComponent = {"id": "zipperTrack", "name": "Zipper (unzipped to mid-chest)", "level": "micro", "role": "body", "importance": 0.7, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Zipper (unzipped to mid-chest) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "torso", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.05, "height": 1.068, "depth": 0.02, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.267, 0.53625], "rotation": [0, 0, 0], "scale": [0.05, 1.068, 0.02]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "zipperTrack", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["vertical teeth + pull tab", "flanked by two drawstrings"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "zipperTrack-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 16, 14, 1.0)", "secondaryAlbedo": "rgba(12, 9, 8, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_zipperTrack_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "zipperTrack", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["torso"] ?? root).add(node_zipperTrack_3);
  nodes["zipperTrack"] = node_zipperTrack_3;
  const mesh_zipperTrack_3Geometry = endpoint_zipperTrack_3
    ? new THREE.CylinderGeometry(endpoint_zipperTrack_3.endRadius, endpoint_zipperTrack_3.baseRadius, endpoint_zipperTrack_3.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_zipperTrack_3) {
    mesh_zipperTrack_3Geometry.scale(0.05, 1.068, 0.02);
  }
  const mesh_zipperTrack_3 = new THREE.Mesh(
    mesh_zipperTrack_3Geometry,
    materialMap["metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_zipperTrack_3.name = "Zipper (unzipped to mid-chest)";
  if (endpoint_zipperTrack_3) {
    mesh_zipperTrack_3.position.copy(endpoint_zipperTrack_3.midpoint);
    mesh_zipperTrack_3.quaternion.copy(endpoint_zipperTrack_3.quaternion);
  }
  mesh_zipperTrack_3.castShadow = options.castShadow ?? true;
  mesh_zipperTrack_3.receiveShadow = options.receiveShadow ?? true;
  mesh_zipperTrack_3.userData.sculptComponent = {"id": "zipperTrack", "name": "Zipper (unzipped to mid-chest)", "level": "micro", "role": "body", "importance": 0.7, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Zipper (unzipped to mid-chest) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "torso", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.05, "height": 1.068, "depth": 0.02, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.267, 0.53625], "rotation": [0, 0, 0], "scale": [0.05, 1.068, 0.02]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "zipperTrack", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["vertical teeth + pull tab", "flanked by two drawstrings"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "zipperTrack-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 16, 14, 1.0)", "secondaryAlbedo": "rgba(12, 9, 8, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_zipperTrack_3.add(mesh_zipperTrack_3);
  meshes["zipperTrack"] = mesh_zipperTrack_3;
  colliders["zipperTrack"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["zipperTrack"] ??= [];
  destructionGroups["zipperTrack"].push(node_zipperTrack_3);

  const attachment_drawstringLeft_4 = {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0};
  const endpoint_drawstringLeft_4 = makeAttachmentEndpoint(attachment_drawstringLeft_4);
  const node_drawstringLeft_4 = new THREE.Group();
  node_drawstringLeft_4.name = "Drawstring (left)__pivot";
  node_drawstringLeft_4.scale.set(1, 1, 1);
  if (endpoint_drawstringLeft_4) {
    node_drawstringLeft_4.position.copy(endpoint_drawstringLeft_4.start);
    node_drawstringLeft_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_drawstringLeft_4.position.set(-0.22, -0.35, 0.12);
    node_drawstringLeft_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_drawstringLeft_4.userData.sculptComponent = {"id": "drawstringLeft", "name": "Drawstring (left)", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Drawstring (left) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "hood", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.03, "height": 0.5, "depth": 0.03, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.22, -0.35, 0.12], "rotation": [0, 0, 0], "scale": [0.03, 0.5, 0.03]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drawstringLeft", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cord", "materialLayers": ["cord"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["hangs free below the hood, ends in a metal cord-lock aglet"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "zipperTrack-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_drawstringLeft_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drawstringLeft", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["hood"] ?? root).add(node_drawstringLeft_4);
  nodes["drawstringLeft"] = node_drawstringLeft_4;
  const mesh_drawstringLeft_4Geometry = endpoint_drawstringLeft_4
    ? new THREE.CylinderGeometry(endpoint_drawstringLeft_4.endRadius, endpoint_drawstringLeft_4.baseRadius, endpoint_drawstringLeft_4.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_drawstringLeft_4) {
    mesh_drawstringLeft_4Geometry.scale(0.03, 0.5, 0.03);
  }
  const mesh_drawstringLeft_4 = new THREE.Mesh(
    mesh_drawstringLeft_4Geometry,
    materialMap["cord"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_drawstringLeft_4.name = "Drawstring (left)";
  if (endpoint_drawstringLeft_4) {
    mesh_drawstringLeft_4.position.copy(endpoint_drawstringLeft_4.midpoint);
    mesh_drawstringLeft_4.quaternion.copy(endpoint_drawstringLeft_4.quaternion);
  }
  mesh_drawstringLeft_4.castShadow = options.castShadow ?? true;
  mesh_drawstringLeft_4.receiveShadow = options.receiveShadow ?? true;
  mesh_drawstringLeft_4.userData.sculptComponent = {"id": "drawstringLeft", "name": "Drawstring (left)", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Drawstring (left) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "hood", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.03, "height": 0.5, "depth": 0.03, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.22, -0.35, 0.12], "rotation": [0, 0, 0], "scale": [0.03, 0.5, 0.03]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drawstringLeft", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cord", "materialLayers": ["cord"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["hangs free below the hood, ends in a metal cord-lock aglet"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "zipperTrack-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_drawstringLeft_4.add(mesh_drawstringLeft_4);
  meshes["drawstringLeft"] = mesh_drawstringLeft_4;
  colliders["drawstringLeft"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["drawstringLeft"] ??= [];
  destructionGroups["drawstringLeft"].push(node_drawstringLeft_4);

  const attachment_drawstringRight_5 = {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0};
  const endpoint_drawstringRight_5 = makeAttachmentEndpoint(attachment_drawstringRight_5);
  const node_drawstringRight_5 = new THREE.Group();
  node_drawstringRight_5.name = "Drawstring (right)__pivot";
  node_drawstringRight_5.scale.set(1, 1, 1);
  if (endpoint_drawstringRight_5) {
    node_drawstringRight_5.position.copy(endpoint_drawstringRight_5.start);
    node_drawstringRight_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_drawstringRight_5.position.set(0.22, -0.35, 0.12);
    node_drawstringRight_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_drawstringRight_5.userData.sculptComponent = {"id": "drawstringRight", "name": "Drawstring (right)", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Drawstring (right) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "hood", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.03, "height": 0.5, "depth": 0.03, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.22, -0.35, 0.12], "rotation": [0, 0, 0], "scale": [0.03, 0.5, 0.03]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drawstringRight", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cord", "materialLayers": ["cord"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["hangs free below the hood, ends in a metal cord-lock aglet"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "zipperTrack-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_drawstringRight_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drawstringRight", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["hood"] ?? root).add(node_drawstringRight_5);
  nodes["drawstringRight"] = node_drawstringRight_5;
  const mesh_drawstringRight_5Geometry = endpoint_drawstringRight_5
    ? new THREE.CylinderGeometry(endpoint_drawstringRight_5.endRadius, endpoint_drawstringRight_5.baseRadius, endpoint_drawstringRight_5.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_drawstringRight_5) {
    mesh_drawstringRight_5Geometry.scale(0.03, 0.5, 0.03);
  }
  const mesh_drawstringRight_5 = new THREE.Mesh(
    mesh_drawstringRight_5Geometry,
    materialMap["cord"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_drawstringRight_5.name = "Drawstring (right)";
  if (endpoint_drawstringRight_5) {
    mesh_drawstringRight_5.position.copy(endpoint_drawstringRight_5.midpoint);
    mesh_drawstringRight_5.quaternion.copy(endpoint_drawstringRight_5.quaternion);
  }
  mesh_drawstringRight_5.castShadow = options.castShadow ?? true;
  mesh_drawstringRight_5.receiveShadow = options.receiveShadow ?? true;
  mesh_drawstringRight_5.userData.sculptComponent = {"id": "drawstringRight", "name": "Drawstring (right)", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Drawstring (right) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "hood", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.03, "height": 0.5, "depth": 0.03, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.22, -0.35, 0.12], "rotation": [0, 0, 0], "scale": [0.03, 0.5, 0.03]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drawstringRight", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cord", "materialLayers": ["cord"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["hangs free below the hood, ends in a metal cord-lock aglet"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "zipperTrack-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_drawstringRight_5.add(mesh_drawstringRight_5);
  meshes["drawstringRight"] = mesh_drawstringRight_5;
  colliders["drawstringRight"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["drawstringRight"] ??= [];
  destructionGroups["drawstringRight"].push(node_drawstringRight_5);

  const endpoint_henleyCollar_6 = makeAttachmentEndpoint(null);
  const node_henleyCollar_6 = new THREE.Group();
  node_henleyCollar_6.name = "Henley collar__pivot";
  node_henleyCollar_6.scale.set(1, 1, 1);
  if (endpoint_henleyCollar_6) {
    node_henleyCollar_6.position.copy(endpoint_henleyCollar_6.start);
    node_henleyCollar_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_henleyCollar_6.position.set(0.0, 0.7475999999999999, 0.482625);
    node_henleyCollar_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_henleyCollar_6.userData.sculptComponent = {"id": "henleyCollar", "name": "Henley collar", "level": "meso", "role": "body", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Henley collar is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "torso", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.32, "height": 0.22, "depth": 0.12, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.7475999999999999, 0.482625], "rotation": [0, 0, 0], "scale": [0.32, 0.22, 0.12]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "henleyCollar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "henleyKnit", "materialLayers": ["henleyKnit"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["visible through the hoodie's unzipped V", "2-3 buttons"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "henleyCollar-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 16, 14, 1.0)", "secondaryAlbedo": "rgba(12, 9, 8, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_henleyCollar_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "henleyCollar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["torso"] ?? root).add(node_henleyCollar_6);
  nodes["henleyCollar"] = node_henleyCollar_6;
  const mesh_henleyCollar_6Geometry = endpoint_henleyCollar_6
    ? new THREE.CylinderGeometry(endpoint_henleyCollar_6.endRadius, endpoint_henleyCollar_6.baseRadius, endpoint_henleyCollar_6.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_henleyCollar_6) {
    mesh_henleyCollar_6Geometry.scale(0.32, 0.22, 0.12);
  }
  const mesh_henleyCollar_6 = new THREE.Mesh(
    mesh_henleyCollar_6Geometry,
    materialMap["henleyKnit"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_henleyCollar_6.name = "Henley collar";
  if (endpoint_henleyCollar_6) {
    mesh_henleyCollar_6.position.copy(endpoint_henleyCollar_6.midpoint);
    mesh_henleyCollar_6.quaternion.copy(endpoint_henleyCollar_6.quaternion);
  }
  mesh_henleyCollar_6.castShadow = options.castShadow ?? true;
  mesh_henleyCollar_6.receiveShadow = options.receiveShadow ?? true;
  mesh_henleyCollar_6.userData.sculptComponent = {"id": "henleyCollar", "name": "Henley collar", "level": "meso", "role": "body", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Henley collar is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "torso", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.32, "height": 0.22, "depth": 0.12, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.7475999999999999, 0.482625], "rotation": [0, 0, 0], "scale": [0.32, 0.22, 0.12]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "henleyCollar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "henleyKnit", "materialLayers": ["henleyKnit"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["visible through the hoodie's unzipped V", "2-3 buttons"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "henleyCollar-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 16, 14, 1.0)", "secondaryAlbedo": "rgba(12, 9, 8, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_henleyCollar_6.add(mesh_henleyCollar_6);
  meshes["henleyCollar"] = mesh_henleyCollar_6;
  colliders["henleyCollar"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["henleyCollar"] ??= [];
  destructionGroups["henleyCollar"].push(node_henleyCollar_6);

  const attachment_neck_7 = {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0};
  const endpoint_neck_7 = makeAttachmentEndpoint(attachment_neck_7);
  const node_neck_7 = new THREE.Group();
  node_neck_7.name = "Neck__pivot";
  node_neck_7.scale.set(1, 1, 1);
  if (endpoint_neck_7) {
    node_neck_7.position.copy(endpoint_neck_7.start);
    node_neck_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_neck_7.position.set(0.0, 1.065, 0.0);
    node_neck_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_neck_7.userData.sculptComponent = {"id": "neck", "name": "Neck", "level": "macro", "role": "body", "importance": 0.7, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Neck is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "torso", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.35, "height": 0.35, "depth": 0.35, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 1.065, 0], "rotation": [0, 0, 0], "scale": [0.35, 0.35, 0.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "neck-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_neck_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["torso"] ?? root).add(node_neck_7);
  nodes["neck"] = node_neck_7;
  const mesh_neck_7Geometry = endpoint_neck_7
    ? new THREE.CylinderGeometry(endpoint_neck_7.endRadius, endpoint_neck_7.baseRadius, endpoint_neck_7.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_neck_7) {
    mesh_neck_7Geometry.scale(0.35, 0.35, 0.35);
  }
  const mesh_neck_7 = new THREE.Mesh(
    mesh_neck_7Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_neck_7.name = "Neck";
  if (endpoint_neck_7) {
    mesh_neck_7.position.copy(endpoint_neck_7.midpoint);
    mesh_neck_7.quaternion.copy(endpoint_neck_7.quaternion);
  }
  mesh_neck_7.castShadow = options.castShadow ?? true;
  mesh_neck_7.receiveShadow = options.receiveShadow ?? true;
  mesh_neck_7.userData.sculptComponent = {"id": "neck", "name": "Neck", "level": "macro", "role": "body", "importance": 0.7, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Neck is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "torso", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.35, "height": 0.35, "depth": 0.35, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 1.065, 0], "rotation": [0, 0, 0], "scale": [0.35, 0.35, 0.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "neck-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_neck_7.add(mesh_neck_7);
  meshes["neck"] = mesh_neck_7;
  colliders["neck"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_neck_7);

  const endpoint_head_8 = makeAttachmentEndpoint(null);
  const node_head_8 = new THREE.Group();
  node_head_8.name = "Head__pivot";
  node_head_8.scale.set(1, 1, 1);
  if (endpoint_head_8) {
    node_head_8.position.copy(endpoint_head_8.start);
    node_head_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_head_8.position.set(0.0, 0.675, 0.0);
    node_head_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_head_8.userData.sculptComponent = {"id": "head", "name": "Head", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Head is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "neck", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.78, "height": 1.0, "depth": 0.85, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.675, 0], "rotation": [0, 0, 0], "scale": [0.78, 1.0, 0.85]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "faceplate-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_head_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["neck"] ?? root).add(node_head_8);
  nodes["head"] = node_head_8;
  const mesh_head_8Geometry = endpoint_head_8
    ? new THREE.CylinderGeometry(endpoint_head_8.endRadius, endpoint_head_8.baseRadius, endpoint_head_8.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_head_8) {
    mesh_head_8Geometry.scale(0.78, 1.0, 0.85);
  }
  const mesh_head_8 = new THREE.Mesh(
    mesh_head_8Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_head_8.name = "Head";
  if (endpoint_head_8) {
    mesh_head_8.position.copy(endpoint_head_8.midpoint);
    mesh_head_8.quaternion.copy(endpoint_head_8.quaternion);
  }
  mesh_head_8.castShadow = options.castShadow ?? true;
  mesh_head_8.receiveShadow = options.receiveShadow ?? true;
  mesh_head_8.userData.sculptComponent = {"id": "head", "name": "Head", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Head is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "neck", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.78, "height": 1.0, "depth": 0.85, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.675, 0], "rotation": [0, 0, 0], "scale": [0.78, 1.0, 0.85]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "faceplate-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_head_8.add(mesh_head_8);
  meshes["head"] = mesh_head_8;
  colliders["head"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_head_8);

  const endpoint_hairMass_9 = makeAttachmentEndpoint(null);
  const node_hairMass_9 = new THREE.Group();
  node_hairMass_9.name = "Hair (curl-cluster mass)__pivot";
  node_hairMass_9.scale.set(1, 1, 1);
  if (endpoint_hairMass_9) {
    node_hairMass_9.position.copy(endpoint_hairMass_9.start);
    node_hairMass_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_hairMass_9.position.set(0.03, 0.19, -0.0255);
    node_hairMass_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_hairMass_9.userData.sculptComponent = {"id": "hairMass", "name": "Hair (curl-cluster mass)", "level": "meso", "role": "body", "importance": 0.95, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Hair (curl-cluster mass) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.8736000000000002, "height": 0.62, "depth": 0.935, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.03, 0.19, -0.0255], "rotation": [0, 0, 0], "scale": [0.8736000000000002, 0.62, 0.935]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hairMass", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["fuller/higher on proper-left side of the part", "receding slightly at both temples", "5-15 stylized clump sub-masses, not strand geometry (reconstruction.md)"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "hairMass-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 92, 58, 1.0)", "secondaryAlbedo": "rgba(100, 55, 34, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.6, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_hairMass_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hairMass", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_hairMass_9);
  nodes["hairMass"] = node_hairMass_9;
  const mesh_hairMass_9Geometry = endpoint_hairMass_9
    ? new THREE.CylinderGeometry(endpoint_hairMass_9.endRadius, endpoint_hairMass_9.baseRadius, endpoint_hairMass_9.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_hairMass_9) {
    mesh_hairMass_9Geometry.scale(0.8736000000000002, 0.62, 0.935);
  }
  const mesh_hairMass_9 = new THREE.Mesh(
    mesh_hairMass_9Geometry,
    materialMap["hair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hairMass_9.name = "Hair (curl-cluster mass)";
  if (endpoint_hairMass_9) {
    mesh_hairMass_9.position.copy(endpoint_hairMass_9.midpoint);
    mesh_hairMass_9.quaternion.copy(endpoint_hairMass_9.quaternion);
  }
  mesh_hairMass_9.castShadow = options.castShadow ?? true;
  mesh_hairMass_9.receiveShadow = options.receiveShadow ?? true;
  mesh_hairMass_9.userData.sculptComponent = {"id": "hairMass", "name": "Hair (curl-cluster mass)", "level": "meso", "role": "body", "importance": 0.95, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Hair (curl-cluster mass) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.8736000000000002, "height": 0.62, "depth": 0.935, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.03, 0.19, -0.0255], "rotation": [0, 0, 0], "scale": [0.8736000000000002, 0.62, 0.935]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hairMass", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["fuller/higher on proper-left side of the part", "receding slightly at both temples", "5-15 stylized clump sub-masses, not strand geometry (reconstruction.md)"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "hairMass-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 92, 58, 1.0)", "secondaryAlbedo": "rgba(100, 55, 34, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.6, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_hairMass_9.add(mesh_hairMass_9);
  meshes["hairMass"] = mesh_hairMass_9;
  colliders["hairMass"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["hairMass"] ??= [];
  destructionGroups["hairMass"].push(node_hairMass_9);

  const endpoint_browLeft_10 = makeAttachmentEndpoint(null);
  const node_browLeft_10 = new THREE.Group();
  node_browLeft_10.name = "Brow (left)__pivot";
  node_browLeft_10.scale.set(1, 1, 1);
  if (endpoint_browLeft_10) {
    node_browLeft_10.position.copy(endpoint_browLeft_10.start);
    node_browLeft_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_browLeft_10.position.set(-0.14, 0.05199999999999998, 0.357);
    node_browLeft_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_browLeft_10.userData.sculptComponent = {"id": "browLeft", "name": "Brow (left)", "level": "meso", "role": "body", "importance": 0.4, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Brow (left) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.14, "height": 0.03, "depth": 0.03, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.14, 0.05199999999999998, 0.357], "rotation": [0, 0, 0], "scale": [0.14, 0.03, 0.03]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "browLeft", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "faceplate-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_browLeft_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "browLeft", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_browLeft_10);
  nodes["browLeft"] = node_browLeft_10;
  const mesh_browLeft_10Geometry = endpoint_browLeft_10
    ? new THREE.CylinderGeometry(endpoint_browLeft_10.endRadius, endpoint_browLeft_10.baseRadius, endpoint_browLeft_10.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_browLeft_10) {
    mesh_browLeft_10Geometry.scale(0.14, 0.03, 0.03);
  }
  const mesh_browLeft_10 = new THREE.Mesh(
    mesh_browLeft_10Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_browLeft_10.name = "Brow (left)";
  if (endpoint_browLeft_10) {
    mesh_browLeft_10.position.copy(endpoint_browLeft_10.midpoint);
    mesh_browLeft_10.quaternion.copy(endpoint_browLeft_10.quaternion);
  }
  mesh_browLeft_10.castShadow = options.castShadow ?? true;
  mesh_browLeft_10.receiveShadow = options.receiveShadow ?? true;
  mesh_browLeft_10.userData.sculptComponent = {"id": "browLeft", "name": "Brow (left)", "level": "meso", "role": "body", "importance": 0.4, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Brow (left) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.14, "height": 0.03, "depth": 0.03, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.14, 0.05199999999999998, 0.357], "rotation": [0, 0, 0], "scale": [0.14, 0.03, 0.03]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "browLeft", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "faceplate-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_browLeft_10.add(mesh_browLeft_10);
  meshes["browLeft"] = mesh_browLeft_10;
  colliders["browLeft"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["browLeft"] ??= [];
  destructionGroups["browLeft"].push(node_browLeft_10);

  const endpoint_browRight_11 = makeAttachmentEndpoint(null);
  const node_browRight_11 = new THREE.Group();
  node_browRight_11.name = "Brow (right)__pivot";
  node_browRight_11.scale.set(1, 1, 1);
  if (endpoint_browRight_11) {
    node_browRight_11.position.copy(endpoint_browRight_11.start);
    node_browRight_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_browRight_11.position.set(0.14, 0.05199999999999998, 0.357);
    node_browRight_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_browRight_11.userData.sculptComponent = {"id": "browRight", "name": "Brow (right)", "level": "meso", "role": "body", "importance": 0.4, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Brow (right) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.14, "height": 0.03, "depth": 0.03, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.14, 0.05199999999999998, 0.357], "rotation": [0, 0, 0], "scale": [0.14, 0.03, 0.03]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "browRight", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "faceplate-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_browRight_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "browRight", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_browRight_11);
  nodes["browRight"] = node_browRight_11;
  const mesh_browRight_11Geometry = endpoint_browRight_11
    ? new THREE.CylinderGeometry(endpoint_browRight_11.endRadius, endpoint_browRight_11.baseRadius, endpoint_browRight_11.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_browRight_11) {
    mesh_browRight_11Geometry.scale(0.14, 0.03, 0.03);
  }
  const mesh_browRight_11 = new THREE.Mesh(
    mesh_browRight_11Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_browRight_11.name = "Brow (right)";
  if (endpoint_browRight_11) {
    mesh_browRight_11.position.copy(endpoint_browRight_11.midpoint);
    mesh_browRight_11.quaternion.copy(endpoint_browRight_11.quaternion);
  }
  mesh_browRight_11.castShadow = options.castShadow ?? true;
  mesh_browRight_11.receiveShadow = options.receiveShadow ?? true;
  mesh_browRight_11.userData.sculptComponent = {"id": "browRight", "name": "Brow (right)", "level": "meso", "role": "body", "importance": 0.4, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Brow (right) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.14, "height": 0.03, "depth": 0.03, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.14, 0.05199999999999998, 0.357], "rotation": [0, 0, 0], "scale": [0.14, 0.03, 0.03]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "browRight", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "faceplate-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_browRight_11.add(mesh_browRight_11);
  meshes["browRight"] = mesh_browRight_11;
  colliders["browRight"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["browRight"] ??= [];
  destructionGroups["browRight"].push(node_browRight_11);

  const endpoint_eyeLeft_12 = makeAttachmentEndpoint(null);
  const node_eyeLeft_12 = new THREE.Group();
  node_eyeLeft_12.name = "Eye (left)__pivot";
  node_eyeLeft_12.scale.set(1, 1, 1);
  if (endpoint_eyeLeft_12) {
    node_eyeLeft_12.position.copy(endpoint_eyeLeft_12.start);
    node_eyeLeft_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eyeLeft_12.position.set(-0.14, -0.028000000000000025, 0.357);
    node_eyeLeft_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_eyeLeft_12.userData.sculptComponent = {"id": "eyeLeft", "name": "Eye (left)", "level": "meso", "role": "body", "importance": 0.75, "confidence": 0.8, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Eye (left) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.09, "height": 0.09, "depth": 0.09, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.14, -0.028000000000000025, 0.357], "rotation": [0, 0, 0], "scale": [0.09, 0.09, 0.09]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eyeLeft", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "eye", "materialLayers": ["eye"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["glossy sphere + darker iris disc + a small bright catchlight offset toward the key light"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "faceplate-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 236, 224, 1.0)", "secondaryAlbedo": "rgba(145, 141, 134, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_eyeLeft_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eyeLeft", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_eyeLeft_12);
  nodes["eyeLeft"] = node_eyeLeft_12;
  const mesh_eyeLeft_12Geometry = endpoint_eyeLeft_12
    ? new THREE.CylinderGeometry(endpoint_eyeLeft_12.endRadius, endpoint_eyeLeft_12.baseRadius, endpoint_eyeLeft_12.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_eyeLeft_12) {
    mesh_eyeLeft_12Geometry.scale(0.09, 0.09, 0.09);
  }
  const mesh_eyeLeft_12 = new THREE.Mesh(
    mesh_eyeLeft_12Geometry,
    materialMap["eye"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eyeLeft_12.name = "Eye (left)";
  if (endpoint_eyeLeft_12) {
    mesh_eyeLeft_12.position.copy(endpoint_eyeLeft_12.midpoint);
    mesh_eyeLeft_12.quaternion.copy(endpoint_eyeLeft_12.quaternion);
  }
  mesh_eyeLeft_12.castShadow = options.castShadow ?? true;
  mesh_eyeLeft_12.receiveShadow = options.receiveShadow ?? true;
  mesh_eyeLeft_12.userData.sculptComponent = {"id": "eyeLeft", "name": "Eye (left)", "level": "meso", "role": "body", "importance": 0.75, "confidence": 0.8, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Eye (left) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.09, "height": 0.09, "depth": 0.09, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.14, -0.028000000000000025, 0.357], "rotation": [0, 0, 0], "scale": [0.09, 0.09, 0.09]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eyeLeft", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "eye", "materialLayers": ["eye"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["glossy sphere + darker iris disc + a small bright catchlight offset toward the key light"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "faceplate-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 236, 224, 1.0)", "secondaryAlbedo": "rgba(145, 141, 134, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_eyeLeft_12.add(mesh_eyeLeft_12);
  meshes["eyeLeft"] = mesh_eyeLeft_12;
  colliders["eyeLeft"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["eyeLeft"] ??= [];
  destructionGroups["eyeLeft"].push(node_eyeLeft_12);

  const endpoint_eyeRight_13 = makeAttachmentEndpoint(null);
  const node_eyeRight_13 = new THREE.Group();
  node_eyeRight_13.name = "Eye (right)__pivot";
  node_eyeRight_13.scale.set(1, 1, 1);
  if (endpoint_eyeRight_13) {
    node_eyeRight_13.position.copy(endpoint_eyeRight_13.start);
    node_eyeRight_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eyeRight_13.position.set(0.14, -0.028000000000000025, 0.357);
    node_eyeRight_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_eyeRight_13.userData.sculptComponent = {"id": "eyeRight", "name": "Eye (right)", "level": "meso", "role": "body", "importance": 0.75, "confidence": 0.8, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Eye (right) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.09, "height": 0.09, "depth": 0.09, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.14, -0.028000000000000025, 0.357], "rotation": [0, 0, 0], "scale": [0.09, 0.09, 0.09]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eyeRight", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "eye", "materialLayers": ["eye"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["glossy sphere + darker iris disc + a small bright catchlight offset toward the key light"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "faceplate-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 236, 224, 1.0)", "secondaryAlbedo": "rgba(145, 141, 134, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_eyeRight_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eyeRight", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_eyeRight_13);
  nodes["eyeRight"] = node_eyeRight_13;
  const mesh_eyeRight_13Geometry = endpoint_eyeRight_13
    ? new THREE.CylinderGeometry(endpoint_eyeRight_13.endRadius, endpoint_eyeRight_13.baseRadius, endpoint_eyeRight_13.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_eyeRight_13) {
    mesh_eyeRight_13Geometry.scale(0.09, 0.09, 0.09);
  }
  const mesh_eyeRight_13 = new THREE.Mesh(
    mesh_eyeRight_13Geometry,
    materialMap["eye"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eyeRight_13.name = "Eye (right)";
  if (endpoint_eyeRight_13) {
    mesh_eyeRight_13.position.copy(endpoint_eyeRight_13.midpoint);
    mesh_eyeRight_13.quaternion.copy(endpoint_eyeRight_13.quaternion);
  }
  mesh_eyeRight_13.castShadow = options.castShadow ?? true;
  mesh_eyeRight_13.receiveShadow = options.receiveShadow ?? true;
  mesh_eyeRight_13.userData.sculptComponent = {"id": "eyeRight", "name": "Eye (right)", "level": "meso", "role": "body", "importance": 0.75, "confidence": 0.8, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Eye (right) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.09, "height": 0.09, "depth": 0.09, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.14, -0.028000000000000025, 0.357], "rotation": [0, 0, 0], "scale": [0.09, 0.09, 0.09]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eyeRight", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "eye", "materialLayers": ["eye"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["glossy sphere + darker iris disc + a small bright catchlight offset toward the key light"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "faceplate-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 236, 224, 1.0)", "secondaryAlbedo": "rgba(145, 141, 134, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_eyeRight_13.add(mesh_eyeRight_13);
  meshes["eyeRight"] = mesh_eyeRight_13;
  colliders["eyeRight"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["eyeRight"] ??= [];
  destructionGroups["eyeRight"].push(node_eyeRight_13);

  const attachment_nose_14 = {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0};
  const endpoint_nose_14 = makeAttachmentEndpoint(attachment_nose_14);
  const node_nose_14 = new THREE.Group();
  node_nose_14.name = "Nose__pivot";
  node_nose_14.scale.set(1, 1, 1);
  if (endpoint_nose_14) {
    node_nose_14.position.copy(endpoint_nose_14.start);
    node_nose_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_nose_14.position.set(0.0, -0.239, 0.391);
    node_nose_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_nose_14.userData.sculptComponent = {"id": "nose", "name": "Nose", "level": "micro", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "Nose is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.12, "height": 0.16, "depth": 0.14, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, -0.239, 0.391], "rotation": [0, 0, 0], "scale": [0.12, 0.16, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nose", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "faceplate-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_nose_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nose", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_nose_14);
  nodes["nose"] = node_nose_14;
  const mesh_nose_14Geometry = endpoint_nose_14
    ? new THREE.CylinderGeometry(endpoint_nose_14.endRadius, endpoint_nose_14.baseRadius, endpoint_nose_14.length, 32, 12)
    : new THREE.ConeGeometry(0.5, 1, 48, 1);
  if (!endpoint_nose_14) {
    mesh_nose_14Geometry.scale(0.12, 0.16, 0.14);
  }
  const mesh_nose_14 = new THREE.Mesh(
    mesh_nose_14Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nose_14.name = "Nose";
  if (endpoint_nose_14) {
    mesh_nose_14.position.copy(endpoint_nose_14.midpoint);
    mesh_nose_14.quaternion.copy(endpoint_nose_14.quaternion);
  }
  mesh_nose_14.castShadow = options.castShadow ?? true;
  mesh_nose_14.receiveShadow = options.receiveShadow ?? true;
  mesh_nose_14.userData.sculptComponent = {"id": "nose", "name": "Nose", "level": "micro", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "Nose is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.12, "height": 0.16, "depth": 0.14, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, -0.239, 0.391], "rotation": [0, 0, 0], "scale": [0.12, 0.16, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nose", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "faceplate-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_nose_14.add(mesh_nose_14);
  meshes["nose"] = mesh_nose_14;
  colliders["nose"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["nose"] ??= [];
  destructionGroups["nose"].push(node_nose_14);

  const endpoint_mouth_15 = makeAttachmentEndpoint(null);
  const node_mouth_15 = new THREE.Group();
  node_mouth_15.name = "Mouth (asymmetric smile)__pivot";
  node_mouth_15.scale.set(1, 1, 1);
  if (endpoint_mouth_15) {
    node_mouth_15.position.copy(endpoint_mouth_15.start);
    node_mouth_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mouth_15.position.set(0.01, -0.353, 0.357);
    node_mouth_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_mouth_15.userData.sculptComponent = {"id": "mouth", "name": "Mouth (asymmetric smile)", "level": "micro", "role": "body", "importance": 0.7, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mouth (asymmetric smile) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.16, "height": 0.04, "depth": 0.04, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.01, -0.353, 0.357], "rotation": [0, 0, 0], "scale": [0.16, 0.04, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["closed-mouth smile, proper-right corner raised more than left -- asymmetric, not mirrored"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "faceplate-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_mouth_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_mouth_15);
  nodes["mouth"] = node_mouth_15;
  const mesh_mouth_15Geometry = endpoint_mouth_15
    ? new THREE.CylinderGeometry(endpoint_mouth_15.endRadius, endpoint_mouth_15.baseRadius, endpoint_mouth_15.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_mouth_15) {
    mesh_mouth_15Geometry.scale(0.16, 0.04, 0.04);
  }
  const mesh_mouth_15 = new THREE.Mesh(
    mesh_mouth_15Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouth_15.name = "Mouth (asymmetric smile)";
  if (endpoint_mouth_15) {
    mesh_mouth_15.position.copy(endpoint_mouth_15.midpoint);
    mesh_mouth_15.quaternion.copy(endpoint_mouth_15.quaternion);
  }
  mesh_mouth_15.castShadow = options.castShadow ?? true;
  mesh_mouth_15.receiveShadow = options.receiveShadow ?? true;
  mesh_mouth_15.userData.sculptComponent = {"id": "mouth", "name": "Mouth (asymmetric smile)", "level": "micro", "role": "body", "importance": 0.7, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mouth (asymmetric smile) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.16, "height": 0.04, "depth": 0.04, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.01, -0.353, 0.357], "rotation": [0, 0, 0], "scale": [0.16, 0.04, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["closed-mouth smile, proper-right corner raised more than left -- asymmetric, not mirrored"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "faceplate-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_mouth_15.add(mesh_mouth_15);
  meshes["mouth"] = mesh_mouth_15;
  colliders["mouth"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["mouth"] ??= [];
  destructionGroups["mouth"].push(node_mouth_15);

  const endpoint_earLeft_16 = makeAttachmentEndpoint(null);
  const node_earLeft_16 = new THREE.Group();
  node_earLeft_16.name = "Ear (left, with earring)__pivot";
  node_earLeft_16.scale.set(1, 1, 1);
  if (endpoint_earLeft_16) {
    node_earLeft_16.position.copy(endpoint_earLeft_16.start);
    node_earLeft_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_earLeft_16.position.set(-0.37, -0.09499999999999997, -0.0425);
    node_earLeft_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_earLeft_16.userData.sculptComponent = {"id": "earLeft", "name": "Ear (left, with earring)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Ear (left, with earring) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.06, "height": 0.14, "depth": 0.08, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.37, -0.09499999999999997, -0.0425], "rotation": [0, 0, 0], "scale": [0.06, 0.14, 0.08]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "earLeft", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["single hoop/stud earring -- asymmetric identity mark, right ear has none"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "earLeft-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_earLeft_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "earLeft", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_earLeft_16);
  nodes["earLeft"] = node_earLeft_16;
  const mesh_earLeft_16Geometry = endpoint_earLeft_16
    ? new THREE.CylinderGeometry(endpoint_earLeft_16.endRadius, endpoint_earLeft_16.baseRadius, endpoint_earLeft_16.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_earLeft_16) {
    mesh_earLeft_16Geometry.scale(0.06, 0.14, 0.08);
  }
  const mesh_earLeft_16 = new THREE.Mesh(
    mesh_earLeft_16Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_earLeft_16.name = "Ear (left, with earring)";
  if (endpoint_earLeft_16) {
    mesh_earLeft_16.position.copy(endpoint_earLeft_16.midpoint);
    mesh_earLeft_16.quaternion.copy(endpoint_earLeft_16.quaternion);
  }
  mesh_earLeft_16.castShadow = options.castShadow ?? true;
  mesh_earLeft_16.receiveShadow = options.receiveShadow ?? true;
  mesh_earLeft_16.userData.sculptComponent = {"id": "earLeft", "name": "Ear (left, with earring)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Ear (left, with earring) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.06, "height": 0.14, "depth": 0.08, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.37, -0.09499999999999997, -0.0425], "rotation": [0, 0, 0], "scale": [0.06, 0.14, 0.08]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "earLeft", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["single hoop/stud earring -- asymmetric identity mark, right ear has none"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "earLeft-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_earLeft_16.add(mesh_earLeft_16);
  meshes["earLeft"] = mesh_earLeft_16;
  colliders["earLeft"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["earLeft"] ??= [];
  destructionGroups["earLeft"].push(node_earLeft_16);

  const endpoint_earRight_17 = makeAttachmentEndpoint(null);
  const node_earRight_17 = new THREE.Group();
  node_earRight_17.name = "Ear (right, occluded in source)__pivot";
  node_earRight_17.scale.set(1, 1, 1);
  if (endpoint_earRight_17) {
    node_earRight_17.position.copy(endpoint_earRight_17.start);
    node_earRight_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_earRight_17.position.set(0.37, -0.09499999999999997, -0.0425);
    node_earRight_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_earRight_17.userData.sculptComponent = {"id": "earRight", "name": "Ear (right, occluded in source)", "level": "meso", "role": "body", "importance": 0.5, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Ear (right, occluded in source) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.06, "height": 0.14, "depth": 0.08, "units": "relative", "confidence": 0.5}, "transform": {"position": [0.37, -0.09499999999999997, -0.0425], "rotation": [0, 0, 0], "scale": [0.06, 0.14, 0.08]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "earRight", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["mirrored from earLeft geometry, no earring -- source photo occludes this side (unknownsToResolveBeforeImplementation)"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "earRight-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_earRight_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "earRight", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_earRight_17);
  nodes["earRight"] = node_earRight_17;
  const mesh_earRight_17Geometry = endpoint_earRight_17
    ? new THREE.CylinderGeometry(endpoint_earRight_17.endRadius, endpoint_earRight_17.baseRadius, endpoint_earRight_17.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_earRight_17) {
    mesh_earRight_17Geometry.scale(0.06, 0.14, 0.08);
  }
  const mesh_earRight_17 = new THREE.Mesh(
    mesh_earRight_17Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_earRight_17.name = "Ear (right, occluded in source)";
  if (endpoint_earRight_17) {
    mesh_earRight_17.position.copy(endpoint_earRight_17.midpoint);
    mesh_earRight_17.quaternion.copy(endpoint_earRight_17.quaternion);
  }
  mesh_earRight_17.castShadow = options.castShadow ?? true;
  mesh_earRight_17.receiveShadow = options.receiveShadow ?? true;
  mesh_earRight_17.userData.sculptComponent = {"id": "earRight", "name": "Ear (right, occluded in source)", "level": "meso", "role": "body", "importance": 0.5, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Ear (right, occluded in source) is a discrete faceted-low-poly primitive assembled onto the bust, not a continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized low-poly character part, flat-shaded facets left visible", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat face normals (flatShading:true) -- the facets ARE the surface language, never smoothed away"}, "parent": "head", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.06, "height": 0.14, "depth": 0.08, "units": "relative", "confidence": 0.5}, "transform": {"position": [0.37, -0.09499999999999997, -0.0425], "rotation": [0, 0, 0], "scale": [0.06, 0.14, 0.08]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "earRight", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["mirrored from earLeft geometry, no earring -- source photo occludes this side (unknownsToResolveBeforeImplementation)"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Faceted low-poly: shading variation comes from real flat-normal lighting response, not painted-in gradients."}, "evidenceRefs": ["full-object", "earRight-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 188, 120, 1.0)", "secondaryAlbedo": "rgba(139, 112, 72, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "notes": "Flat faceted material -- secondaryAlbedo is a darker facet-shadow variant of the same hue, not a separate observed color zone."}};
  node_earRight_17.add(mesh_earRight_17);
  meshes["earRight"] = mesh_earRight_17;
  colliders["earRight"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["earRight"] ??= [];
  destructionGroups["earRight"].push(node_earRight_17);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "stylized-flat-faceted", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": false, "normalOrBumpRequired": false, "localOverridesRequired": false, "minimumTextureResolution": 0, "preferredTextureResolution": 0, "independentMapChannels": ["albedo"], "requiredSurfaceFrequencyBands": [], "geometryReliefRequiredWhenSilhouetteAffected": false, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "targetThreshold": 0.0, "stopOnLowConfidence": false, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Explicitly skipped: this build uses flat per-material palette colors (materials[].baseColor), never texture-extracted PBR maps, per the committed faceted-low-poly direction. See materials[].notes on every material for the reasoning."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createAaronFacetedBustLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Aaron faceted bust look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"role": "key", "type": "directional", "direction": [0.5, 0.8, 0.6], "color": "#f3ece0", "intensity": 1.4, "notes": "Front-upper-right key, matching the source photo's soft daylight-from-above read (image-analysis.md Layer 6). Drives the eye catchlight offset per reconstruction.md."}, {"role": "fill", "type": "ambient", "direction": null, "color": "#2a264a", "intensity": 0.35, "notes": "Low-intensity indigo-tinted ambient fill so shadow-side facets never go fully black -- keeps the faceted geometry readable from every rotation angle."}, {"role": "rim", "type": "directional", "direction": [-0.6, 0.5, -0.4], "color": "#e8bc78", "intensity": 0.6, "notes": "Warm amber rim from upper-back-left, matching the source photo's own backlit-crown highlight on the hair (Layer 6: 'bright warm-blonde rim-lit crown'). Also echoes the hero section's own light-cone color, tying the 3D piece back to the page it sits on."}, {"role": "render-settings", "type": "renderer-config", "direction": null, "color": null, "intensity": null, "notes": "ACES filmic tone mapping, renderer exposure ~1.0, so the amber rim light doesn't clip to flat white on the faceted highlight facets. A soft contact shadow (ground shadow) is cast beneath the bust onto the hero's own light-cone plane so it reads as sitting in the scene, not pasted over it."}];
  lights.userData.lookDevTargets = {"qualityPriority": "stylized-flat-faceted", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": false, "normalOrBumpRequired": false, "localOverridesRequired": false, "minimumTextureResolution": 0, "preferredTextureResolution": 0, "independentMapChannels": ["albedo"], "requiredSurfaceFrequencyBands": [], "geometryReliefRequiredWhenSilhouetteAffected": false, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "targetThreshold": 0.0, "stopOnLowConfidence": false, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Explicitly skipped: this build uses flat per-material palette colors (materials[].baseColor), never texture-extracted PBR maps, per the committed faceted-low-poly direction. See materials[].notes on every material for the reasoning."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createAaronFacetedBustEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameAaronFacetedBustCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createAaronFacetedBustPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureAaronFacetedBustRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createAaronFacetedBustInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
