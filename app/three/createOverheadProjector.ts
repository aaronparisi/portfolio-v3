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

// Generated from ObjectSculptSpec target: Overhead Projector
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createOverheadProjectorModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Overhead Projector";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["hidden"] = createSculptMaterial(
    "hidden",
    {"id": "hidden", "name": "Hidden container", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#000000", "color": "#000000", "albedo": {"dominant": "#000000", "secondary": [], "samplingNotes": "Read directly from image-analysis.md Layer 5/6 -- even studio lighting, no baked highlight/shadow to remove."}, "colorVariation": {"palette": ["#000000"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 1.0, "variation": 0.05, "map": "none", "localResponse": "flat -- molded plastic/metal/glass surface, no procedural variation authored"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.25, "notes": "Standard contact darkening at seams/intersections only."}, "opacity": {"base": 0.0}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["flatShading:false -- this is a real manufactured product's molded/machined shell, smooth vertex normals throughout.", "No texture maps of any kind; MeshStandardMaterial with flat color + roughness/metalness only."], "notes": "Invisible pivot container -- opacity 0 (transparent:true is derived automatically from opacity.base < 1 by the factory generator), never used to hide geometry via scale (BMX-frame lesson).", "textureless": {"declared": true, "reason": "Flat/near-flat PBR region read directly from the reference photo's even studio lighting -- no procedural or reference texture needed (see material-evidence-skip.md).", "evidence": ["grimoire/build/geometry_patterns.md hard-won pattern: container material, never scale"]}},
    options
  );
  materialMap["base-charcoal-shell"] = createSculptMaterial(
    "base-charcoal-shell",
    {"id": "base-charcoal-shell", "name": "Base charcoal shell", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#3a3d40", "color": "#3a3d40", "albedo": {"dominant": "#3a3d40", "secondary": [], "samplingNotes": "Read directly from image-analysis.md Layer 5/6 -- even studio lighting, no baked highlight/shadow to remove."}, "colorVariation": {"palette": ["#3a3d40"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.7, "variation": 0.05, "map": "none", "localResponse": "flat -- molded plastic/metal/glass surface, no procedural variation authored"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.25, "notes": "Standard contact darkening at seams/intersections only."}, "opacity": {"base": 1.0}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["flatShading:false -- this is a real manufactured product's molded/machined shell, smooth vertex normals throughout.", "No texture maps of any kind; MeshStandardMaterial with flat color + roughness/metalness only."], "notes": "Dark neutral charcoal-gray matte plastic -- the base body's dominant shell color (image-analysis.md Layer 5/6).", "textureless": {"declared": true, "reason": "Flat/near-flat PBR region read directly from the reference photo's even studio lighting -- no procedural or reference texture needed (see material-evidence-skip.md).", "evidence": ["image-analysis.md Layer 5/6 (materials & surface, color & finish)"]}},
    options
  );
  materialMap["cream-satin-shell"] = createSculptMaterial(
    "cream-satin-shell",
    {"id": "cream-satin-shell", "name": "Cream satin shell", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#e6ddc9", "color": "#e6ddc9", "albedo": {"dominant": "#e6ddc9", "secondary": [], "samplingNotes": "Read directly from image-analysis.md Layer 5/6 -- even studio lighting, no baked highlight/shadow to remove."}, "colorVariation": {"palette": ["#e6ddc9"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.45, "variation": 0.05, "map": "none", "localResponse": "flat -- molded plastic/metal/glass surface, no procedural variation authored"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.25, "notes": "Standard contact darkening at seams/intersections only."}, "opacity": {"base": 1.0}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "corner-fastener-dot", "region": "topFrame front-right mitred corner", "effect": "small darker fastener/rivet dot", "evidenceRef": "detail-inventory.json zone-r1c2"}, {"id": "label-plate", "region": "topFrame front-left edge", "effect": "near-white rectangular plate, illegible print", "evidenceRef": "detail-inventory.json zone-r1c1"}, {"id": "ruler-ticks", "region": "post front face, full length", "effect": "dense dark horizontal tick-mark scale print", "evidenceRef": "detail-inventory.json zone-r0c0"}], "shaderNotes": ["flatShading:false -- this is a real manufactured product's molded/machined shell, smooth vertex normals throughout.", "No texture maps of any kind; MeshStandardMaterial with flat color + roughness/metalness only."], "notes": "Warm off-white/cream satin plastic -- top frame, post, head housing shell, handle-recess interiors. Visibly glossier than the charcoal body (image-analysis.md Layer 5/6).", "textureless": {"declared": true, "reason": "Flat/near-flat PBR region read directly from the reference photo's even studio lighting -- no procedural or reference texture needed (see material-evidence-skip.md).", "evidence": ["image-analysis.md Layer 5/6 (materials & surface, color & finish)"]}},
    options
  );
  materialMap["platen-glass"] = createSculptMaterial(
    "platen-glass",
    {"id": "platen-glass", "name": "Platen glass", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#dfe6e2", "color": "#dfe6e2", "albedo": {"dominant": "#dfe6e2", "secondary": [], "samplingNotes": "Read directly from image-analysis.md Layer 5/6 -- even studio lighting, no baked highlight/shadow to remove."}, "colorVariation": {"palette": ["#dfe6e2"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.08, "variation": 0.05, "map": "none", "localResponse": "flat -- molded plastic/metal/glass surface, no procedural variation authored"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.25, "notes": "Standard contact darkening at seams/intersections only."}, "opacity": {"base": 1.0}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["flatShading:false -- this is a real manufactured product's molded/machined shell, smooth vertex normals throughout.", "No texture maps of any kind; MeshStandardMaterial with flat color + roughness/metalness only."], "notes": "Near-colorless clear glass/acrylic with a faint warm tint, near-specular. Fresnel-ring relief represented as a normal-pattern note rather than separate ring geometry (image-analysis.md Layer 5).", "textureless": {"declared": true, "reason": "Flat/near-flat PBR region read directly from the reference photo's even studio lighting -- no procedural or reference texture needed (see material-evidence-skip.md).", "evidence": ["image-analysis.md Layer 5/6 (materials & surface, color & finish)"]}},
    options
  );
  materialMap["mirror-coating"] = createSculptMaterial(
    "mirror-coating",
    {"id": "mirror-coating", "name": "Mirror coating", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#f2f2f0", "color": "#f2f2f0", "albedo": {"dominant": "#f2f2f0", "secondary": [], "samplingNotes": "Read directly from image-analysis.md Layer 5/6 -- even studio lighting, no baked highlight/shadow to remove."}, "colorVariation": {"palette": ["#f2f2f0"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.03, "variation": 0.05, "map": "none", "localResponse": "flat -- molded plastic/metal/glass surface, no procedural variation authored"}, "metalness": {"base": 0.15, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.25, "notes": "Standard contact darkening at seams/intersections only."}, "opacity": {"base": 1.0}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["flatShading:false -- this is a real manufactured product's molded/machined shell, smooth vertex normals throughout.", "No texture maps of any kind; MeshStandardMaterial with flat color + roughness/metalness only."], "notes": "High-reflectivity coated panel underside of the head's mirror flap -- reads blown-out/bright under studio light (image-analysis.md Layer 5). Low metalness kept deliberately small: this is a coated dielectric surface, not raw sheet metal.", "textureless": {"declared": true, "reason": "Flat/near-flat PBR region read directly from the reference photo's even studio lighting -- no procedural or reference texture needed (see material-evidence-skip.md).", "evidence": ["image-analysis.md Layer 5/6 (materials & surface, color & finish)"]}},
    options
  );
  materialMap["arm-painted-metal"] = createSculptMaterial(
    "arm-painted-metal",
    {"id": "arm-painted-metal", "name": "Arm painted metal", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#4a4d50", "color": "#4a4d50", "albedo": {"dominant": "#4a4d50", "secondary": [], "samplingNotes": "Read directly from image-analysis.md Layer 5/6 -- even studio lighting, no baked highlight/shadow to remove."}, "colorVariation": {"palette": ["#4a4d50"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.5, "variation": 0.05, "map": "none", "localResponse": "flat -- molded plastic/metal/glass surface, no procedural variation authored"}, "metalness": {"base": 0.25, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.25, "notes": "Standard contact darkening at seams/intersections only."}, "opacity": {"base": 1.0}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["flatShading:false -- this is a real manufactured product's molded/machined shell, smooth vertex normals throughout.", "No texture maps of any kind; MeshStandardMaterial with flat color + roughness/metalness only."], "notes": "Matte dark charcoal painted metal tube -- horizontal arm segments (image-analysis.md Layer 5).", "textureless": {"declared": true, "reason": "Flat/near-flat PBR region read directly from the reference photo's even studio lighting -- no procedural or reference texture needed (see material-evidence-skip.md).", "evidence": ["image-analysis.md Layer 5/6 (materials & surface, color & finish)"]}},
    options
  );
  materialMap["control-blue-plastic"] = createSculptMaterial(
    "control-blue-plastic",
    {"id": "control-blue-plastic", "name": "Control blue plastic", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#3a5fb0", "color": "#3a5fb0", "albedo": {"dominant": "#3a5fb0", "secondary": [], "samplingNotes": "Read directly from image-analysis.md Layer 5/6 -- even studio lighting, no baked highlight/shadow to remove."}, "colorVariation": {"palette": ["#3a5fb0"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.3, "variation": 0.05, "map": "none", "localResponse": "flat -- molded plastic/metal/glass surface, no procedural variation authored"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.25, "notes": "Standard contact darkening at seams/intersections only."}, "opacity": {"base": 1.0}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["flatShading:false -- this is a real manufactured product's molded/machined shell, smooth vertex normals throughout.", "No texture maps of any kind; MeshStandardMaterial with flat color + roughness/metalness only."], "notes": "Vivid mid-blue satin-gloss plastic -- main dial knob, post clamp/lock knobs, secondary gauge dial (image-analysis.md Layer 5/6).", "textureless": {"declared": true, "reason": "Flat/near-flat PBR region read directly from the reference photo's even studio lighting -- no procedural or reference texture needed (see material-evidence-skip.md).", "evidence": ["image-analysis.md Layer 5/6 (materials & surface, color & finish)"]}},
    options
  );
  materialMap["gradient-decal"] = createSculptMaterial(
    "gradient-decal",
    {"id": "gradient-decal", "name": "Gradient decal", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#3a7fd0", "color": "#3a7fd0", "albedo": {"dominant": "#3a7fd0", "secondary": [], "samplingNotes": "Read directly from image-analysis.md Layer 5/6 -- even studio lighting, no baked highlight/shadow to remove."}, "colorVariation": {"palette": ["#3a7fd0"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.55, "variation": 0.05, "map": "none", "localResponse": "flat -- molded plastic/metal/glass surface, no procedural variation authored"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.25, "notes": "Standard contact darkening at seams/intersections only."}, "opacity": {"base": 1.0}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "gradient-stops", "region": "full plate face", "effect": "three-stop print: vivid blue (start) -> vivid yellow (mid) -> vivid red/orange-red (end)", "evidenceRef": "image-analysis.md Layer 6, detail-inventory.json zone-r2c1"}], "shaderNotes": ["flatShading:false -- this is a real manufactured product's molded/machined shell, smooth vertex normals throughout.", "No texture maps of any kind; MeshStandardMaterial with flat color + roughness/metalness only."], "notes": "Flat unlit printed gradient arc decal -- base color is the blue stop; the yellow/red stops are authored as a localOverride gradient rather than a separate texture map (projection-route.md).", "textureless": {"declared": true, "reason": "Flat/near-flat PBR region read directly from the reference photo's even studio lighting -- no procedural or reference texture needed (see material-evidence-skip.md).", "evidence": ["image-analysis.md Layer 5/6 (materials & surface, color & finish)"]}},
    options
  );
  materialMap["lens-barrel-dark"] = createSculptMaterial(
    "lens-barrel-dark",
    {"id": "lens-barrel-dark", "name": "Lens barrel dark", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#26282a", "color": "#26282a", "albedo": {"dominant": "#26282a", "secondary": [], "samplingNotes": "Read directly from image-analysis.md Layer 5/6 -- even studio lighting, no baked highlight/shadow to remove."}, "colorVariation": {"palette": ["#26282a"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.4, "variation": 0.05, "map": "none", "localResponse": "flat -- molded plastic/metal/glass surface, no procedural variation authored"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.25, "notes": "Standard contact darkening at seams/intersections only."}, "opacity": {"base": 1.0}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["flatShading:false -- this is a real manufactured product's molded/machined shell, smooth vertex normals throughout.", "No texture maps of any kind; MeshStandardMaterial with flat color + roughness/metalness only."], "notes": "Near-black/dark charcoal semi-gloss plastic -- lens barrel, focus ring, power switch lever (image-analysis.md Layer 5).", "textureless": {"declared": true, "reason": "Flat/near-flat PBR region read directly from the reference photo's even studio lighting -- no procedural or reference texture needed (see material-evidence-skip.md).", "evidence": ["image-analysis.md Layer 5/6 (materials & surface, color & finish)"]}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Overhead Projector (root)__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Overhead Projector (root)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible container pivot; carries no visible geometry of its own (material 'hidden', opacity 0) -- hidden by material per the tube-network/BMX lesson, never by scale, so children keep correct world scale.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": null, "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 0.0)", "secondaryAlbedo": "rgba(0, 0, 0, 0.0)", "materialClass": "unknown", "materialClassConfidence": 0.5, "notes": "Invisible container -- alpha 0, never rendered."}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Overhead Projector (root)";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Overhead Projector (root)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible container pivot; carries no visible geometry of its own (material 'hidden', opacity 0) -- hidden by material per the tube-network/BMX lesson, never by scale, so children keep correct world scale.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": null, "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 0.0)", "secondaryAlbedo": "rgba(0, 0, 0, 0.0)", "materialClass": "unknown", "materialClassConfidence": 0.5, "notes": "Invisible container -- alpha 0, never rendered."}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_root_0);

  const endpoint_base_1 = makeAttachmentEndpoint(null);
  const node_base_1 = new THREE.Group();
  node_base_1.name = "Base body (housing)__pivot";
  node_base_1.scale.set(1, 1, 1);
  if (endpoint_base_1) {
    node_base_1.position.copy(endpoint_base_1.start);
    node_base_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_base_1.position.set(0.0, 0.4, 0.0);
    node_base_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_base_1.userData.sculptComponent = {"id": "base", "name": "Base body (housing)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Squat rounded-rectangular cuboid housing -- the dominant mass of the object; a real box, not a photo-projected slab (image-analysis.md Layer 2).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.6, "height": 0.8, "depth": 1.5, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.4, 0], "rotation": [0, 0, 0], "scale": [1.6, 0.8, 1.5]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.6, 0.8, 1.5], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "base-charcoal-shell", "materialLayers": ["base-charcoal-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 61, 64, 1.0)", "secondaryAlbedo": "rgba(42, 44, 46, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'base-charcoal-shell' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_base_1.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.6, 0.8, 1.5], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["root"] ?? root).add(node_base_1);
  nodes["base"] = node_base_1;
  const mesh_base_1Geometry = endpoint_base_1
    ? new THREE.CylinderGeometry(endpoint_base_1.endRadius, endpoint_base_1.baseRadius, endpoint_base_1.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_base_1) {
    mesh_base_1Geometry.scale(1.6, 0.8, 1.5);
  }
  const mesh_base_1 = new THREE.Mesh(
    mesh_base_1Geometry,
    materialMap["base-charcoal-shell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_base_1.name = "Base body (housing)";
  if (endpoint_base_1) {
    mesh_base_1.position.copy(endpoint_base_1.midpoint);
    mesh_base_1.quaternion.copy(endpoint_base_1.quaternion);
  }
  mesh_base_1.castShadow = options.castShadow ?? true;
  mesh_base_1.receiveShadow = options.receiveShadow ?? true;
  mesh_base_1.userData.sculptComponent = {"id": "base", "name": "Base body (housing)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Squat rounded-rectangular cuboid housing -- the dominant mass of the object; a real box, not a photo-projected slab (image-analysis.md Layer 2).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.6, "height": 0.8, "depth": 1.5, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.4, 0], "rotation": [0, 0, 0], "scale": [1.6, 0.8, 1.5]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.6, 0.8, 1.5], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "base-charcoal-shell", "materialLayers": ["base-charcoal-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 61, 64, 1.0)", "secondaryAlbedo": "rgba(42, 44, 46, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'base-charcoal-shell' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_base_1.add(mesh_base_1);
  meshes["base"] = mesh_base_1;
  colliders["base"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.6, 0.8, 1.5], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_base_1);

  const endpoint_baseSkirt_2 = makeAttachmentEndpoint(null);
  const node_baseSkirt_2 = new THREE.Group();
  node_baseSkirt_2.name = "Base skirt (lower flare band)__pivot";
  node_baseSkirt_2.scale.set(1, 1, 1);
  if (endpoint_baseSkirt_2) {
    node_baseSkirt_2.position.copy(endpoint_baseSkirt_2.start);
    node_baseSkirt_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_baseSkirt_2.position.set(0.0, -0.34, 0.0);
    node_baseSkirt_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_baseSkirt_2.userData.sculptComponent = {"id": "baseSkirt", "name": "Base skirt (lower flare band)", "level": "meso", "role": "body", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A shallow, wider band at the base's lower third -- the molded skirt flare noted in image-analysis.md Layer 2, not a hard architectural edge.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": null, "dimensions": {"width": 1.6800000000000002, "height": 0.12, "depth": 1.58, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, -0.34, 0], "rotation": [0, 0, 0], "scale": [1.6800000000000002, 0.12, 1.58]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "base-charcoal-shell", "materialLayers": ["base-charcoal-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Subtle flare only -- deliberately a small delta over the main body's footprint, not a distinct silhouette break."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 61, 64, 1.0)", "secondaryAlbedo": "rgba(42, 44, 46, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'base-charcoal-shell' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_baseSkirt_2.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["base"] ?? root).add(node_baseSkirt_2);
  nodes["baseSkirt"] = node_baseSkirt_2;
  const mesh_baseSkirt_2Geometry = endpoint_baseSkirt_2
    ? new THREE.CylinderGeometry(endpoint_baseSkirt_2.endRadius, endpoint_baseSkirt_2.baseRadius, endpoint_baseSkirt_2.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_baseSkirt_2) {
    mesh_baseSkirt_2Geometry.scale(1.6800000000000002, 0.12, 1.58);
  }
  const mesh_baseSkirt_2 = new THREE.Mesh(
    mesh_baseSkirt_2Geometry,
    materialMap["base-charcoal-shell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_baseSkirt_2.name = "Base skirt (lower flare band)";
  if (endpoint_baseSkirt_2) {
    mesh_baseSkirt_2.position.copy(endpoint_baseSkirt_2.midpoint);
    mesh_baseSkirt_2.quaternion.copy(endpoint_baseSkirt_2.quaternion);
  }
  mesh_baseSkirt_2.castShadow = options.castShadow ?? true;
  mesh_baseSkirt_2.receiveShadow = options.receiveShadow ?? true;
  mesh_baseSkirt_2.userData.sculptComponent = {"id": "baseSkirt", "name": "Base skirt (lower flare band)", "level": "meso", "role": "body", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A shallow, wider band at the base's lower third -- the molded skirt flare noted in image-analysis.md Layer 2, not a hard architectural edge.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": null, "dimensions": {"width": 1.6800000000000002, "height": 0.12, "depth": 1.58, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, -0.34, 0], "rotation": [0, 0, 0], "scale": [1.6800000000000002, 0.12, 1.58]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "base-charcoal-shell", "materialLayers": ["base-charcoal-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Subtle flare only -- deliberately a small delta over the main body's footprint, not a distinct silhouette break."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 61, 64, 1.0)", "secondaryAlbedo": "rgba(42, 44, 46, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'base-charcoal-shell' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_baseSkirt_2.add(mesh_baseSkirt_2);
  meshes["baseSkirt"] = mesh_baseSkirt_2;
  colliders["baseSkirt"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_baseSkirt_2);

  const endpoint_topFrame_3 = makeAttachmentEndpoint(null);
  const node_topFrame_3 = new THREE.Group();
  node_topFrame_3.name = "Top perimeter bezel/frame__pivot";
  node_topFrame_3.scale.set(1, 1, 1);
  if (endpoint_topFrame_3) {
    node_topFrame_3.position.copy(endpoint_topFrame_3.start);
    node_topFrame_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_topFrame_3.position.set(0.0, 0.46, 0.0);
    node_topFrame_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_topFrame_3.userData.sculptComponent = {"id": "topFrame", "name": "Top perimeter bezel/frame", "level": "meso", "role": "body", "importance": 0.75, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Raised cream bezel running the full top perimeter, holding the platen inset (image-analysis.md Layer 3/4: platen embedded-in base top frame).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": null, "dimensions": {"width": 1.62, "height": 0.12, "depth": 1.52, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 0.46, 0], "rotation": [0, 0, 0], "scale": [1.62, 0.12, 1.52]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "cream-satin-shell", "materialLayers": ["cream-satin-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"type": "raised ridge", "placement": "outer perimeter edge", "size": "thin", "orientation": "horizontal band", "materialEffect": "none", "geometryEffect": "already modeled as the frame's own bevel", "confidence": 0.7}, {"type": "screw or rivet", "placement": "front-right mitred corner", "size": "tiny", "orientation": "flush", "materialEffect": "slightly darker fastener dot", "geometryEffect": "none -- represented via material.localOverrides, not separate geometry (detail-inventory.json zone-r1c2)", "confidence": 0.6}, {"type": "decal or label area", "placement": "front-left frame edge", "size": "small rectangular plate", "orientation": "flush", "materialEffect": "near-white plate color, illegible print", "geometryEffect": "none -- material.localOverrides only", "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(230, 221, 201, 1.0)", "secondaryAlbedo": "rgba(242, 236, 224, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'cream-satin-shell' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_topFrame_3.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["base"] ?? root).add(node_topFrame_3);
  nodes["topFrame"] = node_topFrame_3;
  const mesh_topFrame_3Geometry = endpoint_topFrame_3
    ? new THREE.CylinderGeometry(endpoint_topFrame_3.endRadius, endpoint_topFrame_3.baseRadius, endpoint_topFrame_3.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_topFrame_3) {
    mesh_topFrame_3Geometry.scale(1.62, 0.12, 1.52);
  }
  const mesh_topFrame_3 = new THREE.Mesh(
    mesh_topFrame_3Geometry,
    materialMap["cream-satin-shell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_topFrame_3.name = "Top perimeter bezel/frame";
  if (endpoint_topFrame_3) {
    mesh_topFrame_3.position.copy(endpoint_topFrame_3.midpoint);
    mesh_topFrame_3.quaternion.copy(endpoint_topFrame_3.quaternion);
  }
  mesh_topFrame_3.castShadow = options.castShadow ?? true;
  mesh_topFrame_3.receiveShadow = options.receiveShadow ?? true;
  mesh_topFrame_3.userData.sculptComponent = {"id": "topFrame", "name": "Top perimeter bezel/frame", "level": "meso", "role": "body", "importance": 0.75, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Raised cream bezel running the full top perimeter, holding the platen inset (image-analysis.md Layer 3/4: platen embedded-in base top frame).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": null, "dimensions": {"width": 1.62, "height": 0.12, "depth": 1.52, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 0.46, 0], "rotation": [0, 0, 0], "scale": [1.62, 0.12, 1.52]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "cream-satin-shell", "materialLayers": ["cream-satin-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"type": "raised ridge", "placement": "outer perimeter edge", "size": "thin", "orientation": "horizontal band", "materialEffect": "none", "geometryEffect": "already modeled as the frame's own bevel", "confidence": 0.7}, {"type": "screw or rivet", "placement": "front-right mitred corner", "size": "tiny", "orientation": "flush", "materialEffect": "slightly darker fastener dot", "geometryEffect": "none -- represented via material.localOverrides, not separate geometry (detail-inventory.json zone-r1c2)", "confidence": 0.6}, {"type": "decal or label area", "placement": "front-left frame edge", "size": "small rectangular plate", "orientation": "flush", "materialEffect": "near-white plate color, illegible print", "geometryEffect": "none -- material.localOverrides only", "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(230, 221, 201, 1.0)", "secondaryAlbedo": "rgba(242, 236, 224, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'cream-satin-shell' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_topFrame_3.add(mesh_topFrame_3);
  meshes["topFrame"] = mesh_topFrame_3;
  colliders["topFrame"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_topFrame_3);

  const endpoint_handleNotchLeft_4 = makeAttachmentEndpoint(null);
  const node_handleNotchLeft_4 = new THREE.Group();
  node_handleNotchLeft_4.name = "Left carrying-handle notch__pivot";
  node_handleNotchLeft_4.scale.set(1, 1, 1);
  if (endpoint_handleNotchLeft_4) {
    node_handleNotchLeft_4.position.copy(endpoint_handleNotchLeft_4.start);
    node_handleNotchLeft_4.rotation.set(0.0, 0.7853981633974483, 0.0);
  } else {
    node_handleNotchLeft_4.position.set(-0.78, 0.05, 0.0);
    node_handleNotchLeft_4.rotation.set(0.0, 0.7853981633974483, 0.0);
  }
  node_handleNotchLeft_4.userData.sculptComponent = {"id": "handleNotchLeft", "name": "Left carrying-handle notch", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Triangular wedge notch cut into the base's vertical corner edge -- corrected from an initial rounded-rectangle-pocket guess after the close-up scan (detail-inventory.json zone-r2c0). Approximated with a 45deg-canted box embedded at the corner rather than a boolean cut, since this factory assembles primitives rather than performing CSG subtraction. Named 'notch', not 'recess', deliberately -- a real carved concavity is out of scope for a shallow decorative wedge insert (validate_sculpt_spec.py's recessed-feature gate).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": {"parentSocket": "left-corner", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.03, "gapTolerance": 0.0}, "dimensions": {"width": 0.22, "height": 0.16, "depth": 0.22, "units": "relative", "confidence": 0.75}, "transform": {"position": [-0.78, 0.05, 0], "rotation": [0, 0.7853981633974483, 0], "scale": [0.22, 0.16, 0.22]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "cream-satin-shell", "materialLayers": ["cream-satin-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(230, 221, 201, 1.0)", "secondaryAlbedo": "rgba(242, 236, 224, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'cream-satin-shell' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_handleNotchLeft_4.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["base"] ?? root).add(node_handleNotchLeft_4);
  nodes["handleNotchLeft"] = node_handleNotchLeft_4;
  const mesh_handleNotchLeft_4Geometry = endpoint_handleNotchLeft_4
    ? new THREE.CylinderGeometry(endpoint_handleNotchLeft_4.endRadius, endpoint_handleNotchLeft_4.baseRadius, endpoint_handleNotchLeft_4.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_handleNotchLeft_4) {
    mesh_handleNotchLeft_4Geometry.scale(0.22, 0.16, 0.22);
  }
  const mesh_handleNotchLeft_4 = new THREE.Mesh(
    mesh_handleNotchLeft_4Geometry,
    materialMap["cream-satin-shell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handleNotchLeft_4.name = "Left carrying-handle notch";
  if (endpoint_handleNotchLeft_4) {
    mesh_handleNotchLeft_4.position.copy(endpoint_handleNotchLeft_4.midpoint);
    mesh_handleNotchLeft_4.quaternion.copy(endpoint_handleNotchLeft_4.quaternion);
  }
  mesh_handleNotchLeft_4.castShadow = options.castShadow ?? true;
  mesh_handleNotchLeft_4.receiveShadow = options.receiveShadow ?? true;
  mesh_handleNotchLeft_4.userData.sculptComponent = {"id": "handleNotchLeft", "name": "Left carrying-handle notch", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Triangular wedge notch cut into the base's vertical corner edge -- corrected from an initial rounded-rectangle-pocket guess after the close-up scan (detail-inventory.json zone-r2c0). Approximated with a 45deg-canted box embedded at the corner rather than a boolean cut, since this factory assembles primitives rather than performing CSG subtraction. Named 'notch', not 'recess', deliberately -- a real carved concavity is out of scope for a shallow decorative wedge insert (validate_sculpt_spec.py's recessed-feature gate).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": {"parentSocket": "left-corner", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.03, "gapTolerance": 0.0}, "dimensions": {"width": 0.22, "height": 0.16, "depth": 0.22, "units": "relative", "confidence": 0.75}, "transform": {"position": [-0.78, 0.05, 0], "rotation": [0, 0.7853981633974483, 0], "scale": [0.22, 0.16, 0.22]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "cream-satin-shell", "materialLayers": ["cream-satin-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(230, 221, 201, 1.0)", "secondaryAlbedo": "rgba(242, 236, 224, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'cream-satin-shell' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_handleNotchLeft_4.add(mesh_handleNotchLeft_4);
  meshes["handleNotchLeft"] = mesh_handleNotchLeft_4;
  colliders["handleNotchLeft"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_handleNotchLeft_4);

  const endpoint_handleNotchRight_5 = makeAttachmentEndpoint(null);
  const node_handleNotchRight_5 = new THREE.Group();
  node_handleNotchRight_5.name = "Right carrying-handle notch__pivot";
  node_handleNotchRight_5.scale.set(1, 1, 1);
  if (endpoint_handleNotchRight_5) {
    node_handleNotchRight_5.position.copy(endpoint_handleNotchRight_5.start);
    node_handleNotchRight_5.rotation.set(0.0, -0.7853981633974483, 0.0);
  } else {
    node_handleNotchRight_5.position.set(0.78, 0.05, 0.0);
    node_handleNotchRight_5.rotation.set(0.0, -0.7853981633974483, 0.0);
  }
  node_handleNotchRight_5.userData.sculptComponent = {"id": "handleNotchRight", "name": "Right carrying-handle notch", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mirror of handleNotchLeft -- base's right side is foreshortened in the source photo, inferred symmetric per image-analysis.md Layer 8.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": {"parentSocket": "right-corner", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.03, "gapTolerance": 0.0}, "dimensions": {"width": 0.22, "height": 0.16, "depth": 0.22, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.78, 0.05, 0], "rotation": [0, -0.7853981633974483, 0], "scale": [0.22, 0.16, 0.22]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "cream-satin-shell", "materialLayers": ["cream-satin-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(230, 221, 201, 1.0)", "secondaryAlbedo": "rgba(242, 236, 224, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'cream-satin-shell' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_handleNotchRight_5.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["base"] ?? root).add(node_handleNotchRight_5);
  nodes["handleNotchRight"] = node_handleNotchRight_5;
  const mesh_handleNotchRight_5Geometry = endpoint_handleNotchRight_5
    ? new THREE.CylinderGeometry(endpoint_handleNotchRight_5.endRadius, endpoint_handleNotchRight_5.baseRadius, endpoint_handleNotchRight_5.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_handleNotchRight_5) {
    mesh_handleNotchRight_5Geometry.scale(0.22, 0.16, 0.22);
  }
  const mesh_handleNotchRight_5 = new THREE.Mesh(
    mesh_handleNotchRight_5Geometry,
    materialMap["cream-satin-shell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handleNotchRight_5.name = "Right carrying-handle notch";
  if (endpoint_handleNotchRight_5) {
    mesh_handleNotchRight_5.position.copy(endpoint_handleNotchRight_5.midpoint);
    mesh_handleNotchRight_5.quaternion.copy(endpoint_handleNotchRight_5.quaternion);
  }
  mesh_handleNotchRight_5.castShadow = options.castShadow ?? true;
  mesh_handleNotchRight_5.receiveShadow = options.receiveShadow ?? true;
  mesh_handleNotchRight_5.userData.sculptComponent = {"id": "handleNotchRight", "name": "Right carrying-handle notch", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mirror of handleNotchLeft -- base's right side is foreshortened in the source photo, inferred symmetric per image-analysis.md Layer 8.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": {"parentSocket": "right-corner", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.03, "gapTolerance": 0.0}, "dimensions": {"width": 0.22, "height": 0.16, "depth": 0.22, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.78, 0.05, 0], "rotation": [0, -0.7853981633974483, 0], "scale": [0.22, 0.16, 0.22]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "cream-satin-shell", "materialLayers": ["cream-satin-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(230, 221, 201, 1.0)", "secondaryAlbedo": "rgba(242, 236, 224, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'cream-satin-shell' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_handleNotchRight_5.add(mesh_handleNotchRight_5);
  meshes["handleNotchRight"] = mesh_handleNotchRight_5;
  colliders["handleNotchRight"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_handleNotchRight_5);

  const attachment_controlDialKnob_6 = {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0};
  const endpoint_controlDialKnob_6 = makeAttachmentEndpoint(attachment_controlDialKnob_6);
  const node_controlDialKnob_6 = new THREE.Group();
  node_controlDialKnob_6.name = "Main rotary control knob__pivot";
  node_controlDialKnob_6.scale.set(1, 1, 1);
  if (endpoint_controlDialKnob_6) {
    node_controlDialKnob_6.position.copy(endpoint_controlDialKnob_6.start);
    node_controlDialKnob_6.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_controlDialKnob_6.position.set(0.05, -0.05, 0.77);
    node_controlDialKnob_6.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_controlDialKnob_6.userData.sculptComponent = {"id": "controlDialKnob", "name": "Main rotary control knob", "level": "meso", "role": "body", "importance": 0.85, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Protruding knurled rotary knob on the base's front face, the dominant control-panel element (image-analysis.md Layer 3, detail-inventory zone-r2c1/r2c2).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.22, "height": 0.09, "depth": 0.22, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.05, -0.05, 0.77], "rotation": [1.5707963267948966, 0, 0], "scale": [0.22, 0.09, 0.22]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.22, 0.09, 0.22], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "control-blue-plastic", "materialLayers": ["control-blue-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 95, 176, 1.0)", "secondaryAlbedo": "rgba(44, 74, 140, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'control-blue-plastic' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_controlDialKnob_6.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.22, 0.09, 0.22], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["base"] ?? root).add(node_controlDialKnob_6);
  nodes["controlDialKnob"] = node_controlDialKnob_6;
  const mesh_controlDialKnob_6Geometry = endpoint_controlDialKnob_6
    ? new THREE.CylinderGeometry(endpoint_controlDialKnob_6.endRadius, endpoint_controlDialKnob_6.baseRadius, endpoint_controlDialKnob_6.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_controlDialKnob_6) {
    mesh_controlDialKnob_6Geometry.scale(0.22, 0.09, 0.22);
  }
  const mesh_controlDialKnob_6 = new THREE.Mesh(
    mesh_controlDialKnob_6Geometry,
    materialMap["control-blue-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_controlDialKnob_6.name = "Main rotary control knob";
  if (endpoint_controlDialKnob_6) {
    mesh_controlDialKnob_6.position.copy(endpoint_controlDialKnob_6.midpoint);
    mesh_controlDialKnob_6.quaternion.copy(endpoint_controlDialKnob_6.quaternion);
  }
  mesh_controlDialKnob_6.castShadow = options.castShadow ?? true;
  mesh_controlDialKnob_6.receiveShadow = options.receiveShadow ?? true;
  mesh_controlDialKnob_6.userData.sculptComponent = {"id": "controlDialKnob", "name": "Main rotary control knob", "level": "meso", "role": "body", "importance": 0.85, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Protruding knurled rotary knob on the base's front face, the dominant control-panel element (image-analysis.md Layer 3, detail-inventory zone-r2c1/r2c2).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.22, "height": 0.09, "depth": 0.22, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.05, -0.05, 0.77], "rotation": [1.5707963267948966, 0, 0], "scale": [0.22, 0.09, 0.22]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.22, 0.09, 0.22], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "control-blue-plastic", "materialLayers": ["control-blue-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 95, 176, 1.0)", "secondaryAlbedo": "rgba(44, 74, 140, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'control-blue-plastic' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_controlDialKnob_6.add(mesh_controlDialKnob_6);
  meshes["controlDialKnob"] = mesh_controlDialKnob_6;
  colliders["controlDialKnob"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.22, 0.09, 0.22], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_controlDialKnob_6);

  const endpoint_gaugeArcPlate_7 = makeAttachmentEndpoint(null);
  const node_gaugeArcPlate_7 = new THREE.Group();
  node_gaugeArcPlate_7.name = "Gradient gauge arc plate__pivot";
  node_gaugeArcPlate_7.scale.set(1, 1, 1);
  if (endpoint_gaugeArcPlate_7) {
    node_gaugeArcPlate_7.position.copy(endpoint_gaugeArcPlate_7.start);
    node_gaugeArcPlate_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_gaugeArcPlate_7.position.set(0.02, 0.14, 0.755);
    node_gaugeArcPlate_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_gaugeArcPlate_7.userData.sculptComponent = {"id": "gaugeArcPlate", "name": "Gradient gauge arc plate", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Thin flat plate carrying the printed blue->yellow->red gradient arc -- a genuinely graphic surface, authored as a decal-plate rather than projected texture (projection-route.md).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.42, "height": 0.24, "depth": 0.01, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.02, 0.14, 0.755], "rotation": [0, 0, 0], "scale": [0.42, 0.24, 0.01]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "gradient-decal", "materialLayers": ["gradient-decal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"type": "decal or label area", "placement": "full plate face", "size": "0.42x0.24 rel", "orientation": "front-facing", "materialEffect": "blue->yellow->red gradient print", "geometryEffect": "flat plate, no relief", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 127, 208, 1.0)", "secondaryAlbedo": "rgba(217, 194, 58, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'gradient-decal' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_gaugeArcPlate_7.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["base"] ?? root).add(node_gaugeArcPlate_7);
  nodes["gaugeArcPlate"] = node_gaugeArcPlate_7;
  const mesh_gaugeArcPlate_7Geometry = endpoint_gaugeArcPlate_7
    ? new THREE.CylinderGeometry(endpoint_gaugeArcPlate_7.endRadius, endpoint_gaugeArcPlate_7.baseRadius, endpoint_gaugeArcPlate_7.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_gaugeArcPlate_7) {
    mesh_gaugeArcPlate_7Geometry.scale(0.42, 0.24, 0.01);
  }
  const mesh_gaugeArcPlate_7 = new THREE.Mesh(
    mesh_gaugeArcPlate_7Geometry,
    materialMap["gradient-decal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gaugeArcPlate_7.name = "Gradient gauge arc plate";
  if (endpoint_gaugeArcPlate_7) {
    mesh_gaugeArcPlate_7.position.copy(endpoint_gaugeArcPlate_7.midpoint);
    mesh_gaugeArcPlate_7.quaternion.copy(endpoint_gaugeArcPlate_7.quaternion);
  }
  mesh_gaugeArcPlate_7.castShadow = options.castShadow ?? true;
  mesh_gaugeArcPlate_7.receiveShadow = options.receiveShadow ?? true;
  mesh_gaugeArcPlate_7.userData.sculptComponent = {"id": "gaugeArcPlate", "name": "Gradient gauge arc plate", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Thin flat plate carrying the printed blue->yellow->red gradient arc -- a genuinely graphic surface, authored as a decal-plate rather than projected texture (projection-route.md).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.42, "height": 0.24, "depth": 0.01, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.02, 0.14, 0.755], "rotation": [0, 0, 0], "scale": [0.42, 0.24, 0.01]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "gradient-decal", "materialLayers": ["gradient-decal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"type": "decal or label area", "placement": "full plate face", "size": "0.42x0.24 rel", "orientation": "front-facing", "materialEffect": "blue->yellow->red gradient print", "geometryEffect": "flat plate, no relief", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 127, 208, 1.0)", "secondaryAlbedo": "rgba(217, 194, 58, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'gradient-decal' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_gaugeArcPlate_7.add(mesh_gaugeArcPlate_7);
  meshes["gaugeArcPlate"] = mesh_gaugeArcPlate_7;
  colliders["gaugeArcPlate"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_gaugeArcPlate_7);

  const attachment_secondaryGaugeDial_8 = {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0};
  const endpoint_secondaryGaugeDial_8 = makeAttachmentEndpoint(attachment_secondaryGaugeDial_8);
  const node_secondaryGaugeDial_8 = new THREE.Group();
  node_secondaryGaugeDial_8.name = "Secondary round gauge dial__pivot";
  node_secondaryGaugeDial_8.scale.set(1, 1, 1);
  if (endpoint_secondaryGaugeDial_8) {
    node_secondaryGaugeDial_8.position.copy(endpoint_secondaryGaugeDial_8.start);
    node_secondaryGaugeDial_8.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_secondaryGaugeDial_8.position.set(-0.16, 0.14, 0.765);
    node_secondaryGaugeDial_8.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_secondaryGaugeDial_8.userData.sculptComponent = {"id": "secondaryGaugeDial", "name": "Secondary round gauge dial", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small separate round gauge dial with its own red needle, left of the gradient arc -- an identity feature caught during the close-up detail-inventory scan (zone-r2c2), not visible at whole-frame scale.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.09, "height": 0.015, "depth": 0.09, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.16, 0.14, 0.765], "rotation": [1.5707963267948966, 0, 0], "scale": [0.09, 0.015, 0.09]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "control-blue-plastic", "materialLayers": ["control-blue-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"type": "raised ridge", "placement": "needle across dial face", "size": "thin", "orientation": "radial", "materialEffect": "red accent color", "geometryEffect": "material.localOverride only, no separate needle mesh", "confidence": 0.55}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 95, 176, 1.0)", "secondaryAlbedo": "rgba(44, 74, 140, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'control-blue-plastic' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_secondaryGaugeDial_8.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["base"] ?? root).add(node_secondaryGaugeDial_8);
  nodes["secondaryGaugeDial"] = node_secondaryGaugeDial_8;
  const mesh_secondaryGaugeDial_8Geometry = endpoint_secondaryGaugeDial_8
    ? new THREE.CylinderGeometry(endpoint_secondaryGaugeDial_8.endRadius, endpoint_secondaryGaugeDial_8.baseRadius, endpoint_secondaryGaugeDial_8.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_secondaryGaugeDial_8) {
    mesh_secondaryGaugeDial_8Geometry.scale(0.09, 0.015, 0.09);
  }
  const mesh_secondaryGaugeDial_8 = new THREE.Mesh(
    mesh_secondaryGaugeDial_8Geometry,
    materialMap["control-blue-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_secondaryGaugeDial_8.name = "Secondary round gauge dial";
  if (endpoint_secondaryGaugeDial_8) {
    mesh_secondaryGaugeDial_8.position.copy(endpoint_secondaryGaugeDial_8.midpoint);
    mesh_secondaryGaugeDial_8.quaternion.copy(endpoint_secondaryGaugeDial_8.quaternion);
  }
  mesh_secondaryGaugeDial_8.castShadow = options.castShadow ?? true;
  mesh_secondaryGaugeDial_8.receiveShadow = options.receiveShadow ?? true;
  mesh_secondaryGaugeDial_8.userData.sculptComponent = {"id": "secondaryGaugeDial", "name": "Secondary round gauge dial", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small separate round gauge dial with its own red needle, left of the gradient arc -- an identity feature caught during the close-up detail-inventory scan (zone-r2c2), not visible at whole-frame scale.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.09, "height": 0.015, "depth": 0.09, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.16, 0.14, 0.765], "rotation": [1.5707963267948966, 0, 0], "scale": [0.09, 0.015, 0.09]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "control-blue-plastic", "materialLayers": ["control-blue-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"type": "raised ridge", "placement": "needle across dial face", "size": "thin", "orientation": "radial", "materialEffect": "red accent color", "geometryEffect": "material.localOverride only, no separate needle mesh", "confidence": 0.55}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 95, 176, 1.0)", "secondaryAlbedo": "rgba(44, 74, 140, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'control-blue-plastic' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_secondaryGaugeDial_8.add(mesh_secondaryGaugeDial_8);
  meshes["secondaryGaugeDial"] = mesh_secondaryGaugeDial_8;
  colliders["secondaryGaugeDial"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_secondaryGaugeDial_8);

  const endpoint_powerSwitchLever_9 = makeAttachmentEndpoint(null);
  const node_powerSwitchLever_9 = new THREE.Group();
  node_powerSwitchLever_9.name = "Power rocker switch__pivot";
  node_powerSwitchLever_9.scale.set(1, 1, 1);
  if (endpoint_powerSwitchLever_9) {
    node_powerSwitchLever_9.position.copy(endpoint_powerSwitchLever_9.start);
    node_powerSwitchLever_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_powerSwitchLever_9.position.set(-0.32, -0.02, 0.77);
    node_powerSwitchLever_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_powerSwitchLever_9.userData.sculptComponent = {"id": "powerSwitchLever", "name": "Power rocker switch", "level": "meso", "role": "body", "importance": 0.4, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small 2-position rocker switch left of the control-dial cluster (detail-inventory zone-r2c1).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.1, "height": 0.14, "depth": 0.03, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.32, -0.02, 0.77], "rotation": [0, 0, 0], "scale": [0.1, 0.14, 0.03]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.14, 0.03], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "lens-barrel-dark", "materialLayers": ["lens-barrel-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 40, 42, 1.0)", "secondaryAlbedo": "rgba(20, 21, 22, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'lens-barrel-dark' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_powerSwitchLever_9.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.14, 0.03], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["base"] ?? root).add(node_powerSwitchLever_9);
  nodes["powerSwitchLever"] = node_powerSwitchLever_9;
  const mesh_powerSwitchLever_9Geometry = endpoint_powerSwitchLever_9
    ? new THREE.CylinderGeometry(endpoint_powerSwitchLever_9.endRadius, endpoint_powerSwitchLever_9.baseRadius, endpoint_powerSwitchLever_9.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_powerSwitchLever_9) {
    mesh_powerSwitchLever_9Geometry.scale(0.1, 0.14, 0.03);
  }
  const mesh_powerSwitchLever_9 = new THREE.Mesh(
    mesh_powerSwitchLever_9Geometry,
    materialMap["lens-barrel-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_powerSwitchLever_9.name = "Power rocker switch";
  if (endpoint_powerSwitchLever_9) {
    mesh_powerSwitchLever_9.position.copy(endpoint_powerSwitchLever_9.midpoint);
    mesh_powerSwitchLever_9.quaternion.copy(endpoint_powerSwitchLever_9.quaternion);
  }
  mesh_powerSwitchLever_9.castShadow = options.castShadow ?? true;
  mesh_powerSwitchLever_9.receiveShadow = options.receiveShadow ?? true;
  mesh_powerSwitchLever_9.userData.sculptComponent = {"id": "powerSwitchLever", "name": "Power rocker switch", "level": "meso", "role": "body", "importance": 0.4, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small 2-position rocker switch left of the control-dial cluster (detail-inventory zone-r2c1).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.1, "height": 0.14, "depth": 0.03, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.32, -0.02, 0.77], "rotation": [0, 0, 0], "scale": [0.1, 0.14, 0.03]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.14, 0.03], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "lens-barrel-dark", "materialLayers": ["lens-barrel-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 40, 42, 1.0)", "secondaryAlbedo": "rgba(20, 21, 22, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'lens-barrel-dark' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_powerSwitchLever_9.add(mesh_powerSwitchLever_9);
  meshes["powerSwitchLever"] = mesh_powerSwitchLever_9;
  colliders["powerSwitchLever"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.14, 0.03], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_powerSwitchLever_9);

  const endpoint_platen_10 = makeAttachmentEndpoint(null);
  const node_platen_10 = new THREE.Group();
  node_platen_10.name = "Platen (glass surface)__pivot";
  node_platen_10.scale.set(1, 1, 1);
  if (endpoint_platen_10) {
    node_platen_10.position.copy(endpoint_platen_10.start);
    node_platen_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_platen_10.position.set(0.0, 0.495, 0.0);
    node_platen_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_platen_10.userData.sculptComponent = {"id": "platen", "name": "Platen (glass surface)", "level": "macro", "role": "body", "importance": 0.95, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Large flat glass pane inset flush within topFrame's perimeter (image-analysis.md Layer 2/4) -- the single most recognizable top-down feature of an overhead projector.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": {"parentSocket": "top-frame-inset", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 1.4000000000000001, "height": 0.05, "depth": 1.3, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 0.495, 0], "rotation": [0, 0, 0], "scale": [1.4000000000000001, 0.05, 1.3]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4000000000000001, 0.05, 1.3], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "platen-glass", "materialLayers": ["platen-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"type": "raised ridge", "placement": "concentric rings across the full pane", "size": "full-surface", "orientation": "concentric circles centered on the pane", "materialEffect": "none", "geometryEffect": "represented via material.normal (fresnel relief), not separate ring geometry", "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 230, 226, 1.0)", "secondaryAlbedo": "rgba(201, 210, 206, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.85, "notes": "Matches the 'platen-glass' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_platen_10.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4000000000000001, 0.05, 1.3], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["base"] ?? root).add(node_platen_10);
  nodes["platen"] = node_platen_10;
  const mesh_platen_10Geometry = endpoint_platen_10
    ? new THREE.CylinderGeometry(endpoint_platen_10.endRadius, endpoint_platen_10.baseRadius, endpoint_platen_10.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_platen_10) {
    mesh_platen_10Geometry.scale(1.4000000000000001, 0.05, 1.3);
  }
  const mesh_platen_10 = new THREE.Mesh(
    mesh_platen_10Geometry,
    materialMap["platen-glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_platen_10.name = "Platen (glass surface)";
  if (endpoint_platen_10) {
    mesh_platen_10.position.copy(endpoint_platen_10.midpoint);
    mesh_platen_10.quaternion.copy(endpoint_platen_10.quaternion);
  }
  mesh_platen_10.castShadow = options.castShadow ?? true;
  mesh_platen_10.receiveShadow = options.receiveShadow ?? true;
  mesh_platen_10.userData.sculptComponent = {"id": "platen", "name": "Platen (glass surface)", "level": "macro", "role": "body", "importance": 0.95, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Large flat glass pane inset flush within topFrame's perimeter (image-analysis.md Layer 2/4) -- the single most recognizable top-down feature of an overhead projector.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": {"parentSocket": "top-frame-inset", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 1.4000000000000001, "height": 0.05, "depth": 1.3, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 0.495, 0], "rotation": [0, 0, 0], "scale": [1.4000000000000001, 0.05, 1.3]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4000000000000001, 0.05, 1.3], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "platen-glass", "materialLayers": ["platen-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"type": "raised ridge", "placement": "concentric rings across the full pane", "size": "full-surface", "orientation": "concentric circles centered on the pane", "materialEffect": "none", "geometryEffect": "represented via material.normal (fresnel relief), not separate ring geometry", "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 230, 226, 1.0)", "secondaryAlbedo": "rgba(201, 210, 206, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.85, "notes": "Matches the 'platen-glass' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_platen_10.add(mesh_platen_10);
  meshes["platen"] = mesh_platen_10;
  colliders["platen"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.4000000000000001, 0.05, 1.3], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_platen_10);

  const endpoint_post_11 = makeAttachmentEndpoint(null);
  const node_post_11 = new THREE.Group();
  node_post_11.name = "Vertical arm post__pivot";
  node_post_11.scale.set(1, 1, 1);
  if (endpoint_post_11) {
    node_post_11.position.copy(endpoint_post_11.start);
    node_post_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_post_11.position.set(-0.65, 0.875, -0.55);
    node_post_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_post_11.userData.sculptComponent = {"id": "post", "name": "Vertical arm post", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Tall rectangular-section post mounted at the base's rear-left corner via a bracket/collar (image-analysis.md Layer 4) -- rigid, not a limb, so it stays a plain box rather than an attachment-endpoint cylinder.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": {"parentSocket": "rear-left-corner-bracket", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "socket", "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.0}, "dimensions": {"width": 0.09, "height": 0.95, "depth": 0.09, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.65, 0.875, -0.55], "rotation": [0, 0, 0], "scale": [0.09, 0.95, 0.09]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "cream-satin-shell", "materialLayers": ["cream-satin-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"type": "decal or label area", "placement": "front face, full length", "size": "dense tick marks", "orientation": "vertical ruled scale", "materialEffect": "printed dark tick-mark scale on cream", "geometryEffect": "material.normal/localOverride only", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(230, 221, 201, 1.0)", "secondaryAlbedo": "rgba(242, 236, 224, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'cream-satin-shell' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_post_11.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["base"] ?? root).add(node_post_11);
  nodes["post"] = node_post_11;
  const mesh_post_11Geometry = endpoint_post_11
    ? new THREE.CylinderGeometry(endpoint_post_11.endRadius, endpoint_post_11.baseRadius, endpoint_post_11.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_post_11) {
    mesh_post_11Geometry.scale(0.09, 0.95, 0.09);
  }
  const mesh_post_11 = new THREE.Mesh(
    mesh_post_11Geometry,
    materialMap["cream-satin-shell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_post_11.name = "Vertical arm post";
  if (endpoint_post_11) {
    mesh_post_11.position.copy(endpoint_post_11.midpoint);
    mesh_post_11.quaternion.copy(endpoint_post_11.quaternion);
  }
  mesh_post_11.castShadow = options.castShadow ?? true;
  mesh_post_11.receiveShadow = options.receiveShadow ?? true;
  mesh_post_11.userData.sculptComponent = {"id": "post", "name": "Vertical arm post", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Tall rectangular-section post mounted at the base's rear-left corner via a bracket/collar (image-analysis.md Layer 4) -- rigid, not a limb, so it stays a plain box rather than an attachment-endpoint cylinder.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "base", "attachment": {"parentSocket": "rear-left-corner-bracket", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "socket", "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.0}, "dimensions": {"width": 0.09, "height": 0.95, "depth": 0.09, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.65, 0.875, -0.55], "rotation": [0, 0, 0], "scale": [0.09, 0.95, 0.09]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "cream-satin-shell", "materialLayers": ["cream-satin-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"type": "decal or label area", "placement": "front face, full length", "size": "dense tick marks", "orientation": "vertical ruled scale", "materialEffect": "printed dark tick-mark scale on cream", "geometryEffect": "material.normal/localOverride only", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(230, 221, 201, 1.0)", "secondaryAlbedo": "rgba(242, 236, 224, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'cream-satin-shell' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_post_11.add(mesh_post_11);
  meshes["post"] = mesh_post_11;
  colliders["post"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_post_11);

  const attachment_postLockKnobLower_12 = {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0};
  const endpoint_postLockKnobLower_12 = makeAttachmentEndpoint(attachment_postLockKnobLower_12);
  const node_postLockKnobLower_12 = new THREE.Group();
  node_postLockKnobLower_12.name = "Post secondary lock knob__pivot";
  node_postLockKnobLower_12.scale.set(1, 1, 1);
  if (endpoint_postLockKnobLower_12) {
    node_postLockKnobLower_12.position.copy(endpoint_postLockKnobLower_12.start);
    node_postLockKnobLower_12.rotation.set(0.0, 0.0, 1.5707963267948966);
  } else {
    node_postLockKnobLower_12.position.set(0.09, -0.255, 0.0);
    node_postLockKnobLower_12.rotation.set(0.0, 0.0, 1.5707963267948966);
  }
  node_postLockKnobLower_12.userData.sculptComponent = {"id": "postLockKnobLower", "name": "Post secondary lock knob", "level": "meso", "role": "body", "importance": 0.55, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Secondary blue thumbscrew knob clamping a lower bracket on the post (detail-inventory zone-r1c0), distinct from the main arm-clamp knob at the post's top.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "post", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.1, "height": 0.12, "depth": 0.12, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.09, -0.255, 0], "rotation": [0, 0, 1.5707963267948966], "scale": [0.1, 0.12, 0.12]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "control-blue-plastic", "materialLayers": ["control-blue-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 95, 176, 1.0)", "secondaryAlbedo": "rgba(44, 74, 140, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'control-blue-plastic' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_postLockKnobLower_12.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["post"] ?? root).add(node_postLockKnobLower_12);
  nodes["postLockKnobLower"] = node_postLockKnobLower_12;
  const mesh_postLockKnobLower_12Geometry = endpoint_postLockKnobLower_12
    ? new THREE.CylinderGeometry(endpoint_postLockKnobLower_12.endRadius, endpoint_postLockKnobLower_12.baseRadius, endpoint_postLockKnobLower_12.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_postLockKnobLower_12) {
    mesh_postLockKnobLower_12Geometry.scale(0.1, 0.12, 0.12);
  }
  const mesh_postLockKnobLower_12 = new THREE.Mesh(
    mesh_postLockKnobLower_12Geometry,
    materialMap["control-blue-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_postLockKnobLower_12.name = "Post secondary lock knob";
  if (endpoint_postLockKnobLower_12) {
    mesh_postLockKnobLower_12.position.copy(endpoint_postLockKnobLower_12.midpoint);
    mesh_postLockKnobLower_12.quaternion.copy(endpoint_postLockKnobLower_12.quaternion);
  }
  mesh_postLockKnobLower_12.castShadow = options.castShadow ?? true;
  mesh_postLockKnobLower_12.receiveShadow = options.receiveShadow ?? true;
  mesh_postLockKnobLower_12.userData.sculptComponent = {"id": "postLockKnobLower", "name": "Post secondary lock knob", "level": "meso", "role": "body", "importance": 0.55, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Secondary blue thumbscrew knob clamping a lower bracket on the post (detail-inventory zone-r1c0), distinct from the main arm-clamp knob at the post's top.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "post", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.1, "height": 0.12, "depth": 0.12, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.09, -0.255, 0], "rotation": [0, 0, 1.5707963267948966], "scale": [0.1, 0.12, 0.12]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "control-blue-plastic", "materialLayers": ["control-blue-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 95, 176, 1.0)", "secondaryAlbedo": "rgba(44, 74, 140, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'control-blue-plastic' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_postLockKnobLower_12.add(mesh_postLockKnobLower_12);
  meshes["postLockKnobLower"] = mesh_postLockKnobLower_12;
  colliders["postLockKnobLower"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_postLockKnobLower_12);

  const endpoint_arm_13 = makeAttachmentEndpoint(null);
  const node_arm_13 = new THREE.Group();
  node_arm_13.name = "Arm assembly (pivot)__pivot";
  node_arm_13.scale.set(1, 1, 1);
  if (endpoint_arm_13) {
    node_arm_13.position.copy(endpoint_arm_13.start);
    node_arm_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arm_13.position.set(0.0, 0.475, 0.0);
    node_arm_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_arm_13.userData.sculptComponent = {"id": "arm", "name": "Arm assembly (pivot)", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible pivot group at the post-top clamp joint -- carries armLower/armUpper/headHousing as children so the whole arm+head assembly can tilt about one real hinge, hidden by material (opacity 0) per the container pattern, never by scale.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "post", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.75}, "transform": {"position": [0, 0.475, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "hinge", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 0.0)", "secondaryAlbedo": "rgba(0, 0, 0, 0.0)", "materialClass": "unknown", "materialClassConfidence": 0.5, "notes": "Invisible container -- alpha 0, never rendered."}};
  node_arm_13.userData.actionProfile = {"animationRole": "hinge", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["post"] ?? root).add(node_arm_13);
  nodes["arm"] = node_arm_13;
  const mesh_arm_13Geometry = endpoint_arm_13
    ? new THREE.CylinderGeometry(endpoint_arm_13.endRadius, endpoint_arm_13.baseRadius, endpoint_arm_13.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_arm_13) {
    mesh_arm_13Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_arm_13 = new THREE.Mesh(
    mesh_arm_13Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arm_13.name = "Arm assembly (pivot)";
  if (endpoint_arm_13) {
    mesh_arm_13.position.copy(endpoint_arm_13.midpoint);
    mesh_arm_13.quaternion.copy(endpoint_arm_13.quaternion);
  }
  mesh_arm_13.castShadow = options.castShadow ?? true;
  mesh_arm_13.receiveShadow = options.receiveShadow ?? true;
  mesh_arm_13.userData.sculptComponent = {"id": "arm", "name": "Arm assembly (pivot)", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible pivot group at the post-top clamp joint -- carries armLower/armUpper/headHousing as children so the whole arm+head assembly can tilt about one real hinge, hidden by material (opacity 0) per the container pattern, never by scale.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "post", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.75}, "transform": {"position": [0, 0.475, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "hinge", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 0.0)", "secondaryAlbedo": "rgba(0, 0, 0, 0.0)", "materialClass": "unknown", "materialClassConfidence": 0.5, "notes": "Invisible container -- alpha 0, never rendered."}};
  node_arm_13.add(mesh_arm_13);
  meshes["arm"] = mesh_arm_13;
  colliders["arm"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_arm_13);

  const attachment_clampKnobUpper_14 = {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0};
  const endpoint_clampKnobUpper_14 = makeAttachmentEndpoint(attachment_clampKnobUpper_14);
  const node_clampKnobUpper_14 = new THREE.Group();
  node_clampKnobUpper_14.name = "Main arm clamp knob__pivot";
  node_clampKnobUpper_14.scale.set(1, 1, 1);
  if (endpoint_clampKnobUpper_14) {
    node_clampKnobUpper_14.position.copy(endpoint_clampKnobUpper_14.start);
    node_clampKnobUpper_14.rotation.set(0.0, 0.0, 1.5707963267948966);
  } else {
    node_clampKnobUpper_14.position.set(0.1, 0.0, 0.0);
    node_clampKnobUpper_14.rotation.set(0.0, 0.0, 1.5707963267948966);
  }
  node_clampKnobUpper_14.userData.sculptComponent = {"id": "clampKnobUpper", "name": "Main arm clamp knob", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Large blue knurled clamp knob at the post-top pivot -- the real hardware controlling the arm's height/angle clamp (detail-inventory zone-r1c0).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "arm", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.13, "height": 0.1, "depth": 0.13, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.1, 0, 0], "rotation": [0, 0, 1.5707963267948966], "scale": [0.13, 0.1, 0.13]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "control-blue-plastic", "materialLayers": ["control-blue-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 95, 176, 1.0)", "secondaryAlbedo": "rgba(44, 74, 140, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'control-blue-plastic' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_clampKnobUpper_14.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["arm"] ?? root).add(node_clampKnobUpper_14);
  nodes["clampKnobUpper"] = node_clampKnobUpper_14;
  const mesh_clampKnobUpper_14Geometry = endpoint_clampKnobUpper_14
    ? new THREE.CylinderGeometry(endpoint_clampKnobUpper_14.endRadius, endpoint_clampKnobUpper_14.baseRadius, endpoint_clampKnobUpper_14.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_clampKnobUpper_14) {
    mesh_clampKnobUpper_14Geometry.scale(0.13, 0.1, 0.13);
  }
  const mesh_clampKnobUpper_14 = new THREE.Mesh(
    mesh_clampKnobUpper_14Geometry,
    materialMap["control-blue-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_clampKnobUpper_14.name = "Main arm clamp knob";
  if (endpoint_clampKnobUpper_14) {
    mesh_clampKnobUpper_14.position.copy(endpoint_clampKnobUpper_14.midpoint);
    mesh_clampKnobUpper_14.quaternion.copy(endpoint_clampKnobUpper_14.quaternion);
  }
  mesh_clampKnobUpper_14.castShadow = options.castShadow ?? true;
  mesh_clampKnobUpper_14.receiveShadow = options.receiveShadow ?? true;
  mesh_clampKnobUpper_14.userData.sculptComponent = {"id": "clampKnobUpper", "name": "Main arm clamp knob", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Large blue knurled clamp knob at the post-top pivot -- the real hardware controlling the arm's height/angle clamp (detail-inventory zone-r1c0).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "arm", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.13, "height": 0.1, "depth": 0.13, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.1, 0, 0], "rotation": [0, 0, 1.5707963267948966], "scale": [0.13, 0.1, 0.13]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "control-blue-plastic", "materialLayers": ["control-blue-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 95, 176, 1.0)", "secondaryAlbedo": "rgba(44, 74, 140, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'control-blue-plastic' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_clampKnobUpper_14.add(mesh_clampKnobUpper_14);
  meshes["clampKnobUpper"] = mesh_clampKnobUpper_14;
  colliders["clampKnobUpper"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_clampKnobUpper_14);

  const attachment_armLower_15 = {"parentSocket": "arm-pivot", "localStart": [0, 0, 0], "localEnd": [0.24, 0.42, 0.04], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.045, "endRadius": 0.04};
  const endpoint_armLower_15 = makeAttachmentEndpoint(attachment_armLower_15);
  const node_armLower_15 = new THREE.Group();
  node_armLower_15.name = "Horizontal arm, lower segment__pivot";
  node_armLower_15.scale.set(1, 1, 1);
  if (endpoint_armLower_15) {
    node_armLower_15.position.copy(endpoint_armLower_15.start);
    node_armLower_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_armLower_15.position.set(0.0, 0.0, 0.0);
    node_armLower_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_armLower_15.userData.sculptComponent = {"id": "armLower", "name": "Horizontal arm, lower segment", "level": "meso", "role": "body", "importance": 0.75, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Rising segment of the bent horizontal arm tube, from the post-top pivot to the elbow bend (image-analysis.md Layer 2/4) -- a genuine connector between two joints, built as an attachment-endpoint cylinder rather than a hand-placed box.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "arm", "attachment": {"parentSocket": "arm-pivot", "localStart": [0, 0, 0], "localEnd": [0.24, 0.42, 0.04], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.045, "endRadius": 0.04}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "arm-painted-metal", "materialLayers": ["arm-painted-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(74, 77, 80, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "notes": "Matches the 'arm-painted-metal' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_armLower_15.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["arm"] ?? root).add(node_armLower_15);
  nodes["armLower"] = node_armLower_15;
  const mesh_armLower_15Geometry = endpoint_armLower_15
    ? new THREE.CylinderGeometry(endpoint_armLower_15.endRadius, endpoint_armLower_15.baseRadius, endpoint_armLower_15.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_armLower_15) {
    mesh_armLower_15Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_armLower_15 = new THREE.Mesh(
    mesh_armLower_15Geometry,
    materialMap["arm-painted-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_armLower_15.name = "Horizontal arm, lower segment";
  if (endpoint_armLower_15) {
    mesh_armLower_15.position.copy(endpoint_armLower_15.midpoint);
    mesh_armLower_15.quaternion.copy(endpoint_armLower_15.quaternion);
  }
  mesh_armLower_15.castShadow = options.castShadow ?? true;
  mesh_armLower_15.receiveShadow = options.receiveShadow ?? true;
  mesh_armLower_15.userData.sculptComponent = {"id": "armLower", "name": "Horizontal arm, lower segment", "level": "meso", "role": "body", "importance": 0.75, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Rising segment of the bent horizontal arm tube, from the post-top pivot to the elbow bend (image-analysis.md Layer 2/4) -- a genuine connector between two joints, built as an attachment-endpoint cylinder rather than a hand-placed box.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "arm", "attachment": {"parentSocket": "arm-pivot", "localStart": [0, 0, 0], "localEnd": [0.24, 0.42, 0.04], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.045, "endRadius": 0.04}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "arm-painted-metal", "materialLayers": ["arm-painted-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(74, 77, 80, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "notes": "Matches the 'arm-painted-metal' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_armLower_15.add(mesh_armLower_15);
  meshes["armLower"] = mesh_armLower_15;
  colliders["armLower"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_armLower_15);

  const attachment_armUpper_16 = {"parentSocket": "elbow", "localStart": [0.24, 0.42, 0.04], "localEnd": [0.66, 0.47, 0.34], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.04, "endRadius": 0.04};
  const endpoint_armUpper_16 = makeAttachmentEndpoint(attachment_armUpper_16);
  const node_armUpper_16 = new THREE.Group();
  node_armUpper_16.name = "Horizontal arm, upper segment__pivot";
  node_armUpper_16.scale.set(1, 1, 1);
  if (endpoint_armUpper_16) {
    node_armUpper_16.position.copy(endpoint_armUpper_16.start);
    node_armUpper_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_armUpper_16.position.set(0.0, 0.0, 0.0);
    node_armUpper_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_armUpper_16.userData.sculptComponent = {"id": "armUpper", "name": "Horizontal arm, upper segment", "level": "meso", "role": "body", "importance": 0.75, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Forward-bending segment of the arm tube, from the elbow to the head housing's underside socket -- second half of the tube-network linkage.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "arm", "attachment": {"parentSocket": "elbow", "localStart": [0.24, 0.42, 0.04], "localEnd": [0.66, 0.47, 0.34], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.04, "endRadius": 0.04}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "arm-painted-metal", "materialLayers": ["arm-painted-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(74, 77, 80, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "notes": "Matches the 'arm-painted-metal' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_armUpper_16.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["arm"] ?? root).add(node_armUpper_16);
  nodes["armUpper"] = node_armUpper_16;
  const mesh_armUpper_16Geometry = endpoint_armUpper_16
    ? new THREE.CylinderGeometry(endpoint_armUpper_16.endRadius, endpoint_armUpper_16.baseRadius, endpoint_armUpper_16.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_armUpper_16) {
    mesh_armUpper_16Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_armUpper_16 = new THREE.Mesh(
    mesh_armUpper_16Geometry,
    materialMap["arm-painted-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_armUpper_16.name = "Horizontal arm, upper segment";
  if (endpoint_armUpper_16) {
    mesh_armUpper_16.position.copy(endpoint_armUpper_16.midpoint);
    mesh_armUpper_16.quaternion.copy(endpoint_armUpper_16.quaternion);
  }
  mesh_armUpper_16.castShadow = options.castShadow ?? true;
  mesh_armUpper_16.receiveShadow = options.receiveShadow ?? true;
  mesh_armUpper_16.userData.sculptComponent = {"id": "armUpper", "name": "Horizontal arm, upper segment", "level": "meso", "role": "body", "importance": 0.75, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Forward-bending segment of the arm tube, from the elbow to the head housing's underside socket -- second half of the tube-network linkage.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "arm", "attachment": {"parentSocket": "elbow", "localStart": [0.24, 0.42, 0.04], "localEnd": [0.66, 0.47, 0.34], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.04, "endRadius": 0.04}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "arm-painted-metal", "materialLayers": ["arm-painted-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(74, 77, 80, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "notes": "Matches the 'arm-painted-metal' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_armUpper_16.add(mesh_armUpper_16);
  meshes["armUpper"] = mesh_armUpper_16;
  colliders["armUpper"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_armUpper_16);

  const endpoint_headHousing_17 = makeAttachmentEndpoint(null);
  const node_headHousing_17 = new THREE.Group();
  node_headHousing_17.name = "Head housing (pivot)__pivot";
  node_headHousing_17.scale.set(1, 1, 1);
  if (endpoint_headHousing_17) {
    node_headHousing_17.position.copy(endpoint_headHousing_17.start);
    node_headHousing_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_headHousing_17.position.set(0.66, 0.47, 0.34);
    node_headHousing_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_headHousing_17.userData.sculptComponent = {"id": "headHousing", "name": "Head housing (pivot)", "level": "macro", "role": "body", "importance": 0.85, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible pivot at the arm's forward socket, carrying the lens box and mirror flap so the head can tilt as one hinged unit.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "arm", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.66, 0.47, 0.34], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "hinge", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 0.0)", "secondaryAlbedo": "rgba(0, 0, 0, 0.0)", "materialClass": "unknown", "materialClassConfidence": 0.5, "notes": "Invisible container -- alpha 0, never rendered."}};
  node_headHousing_17.userData.actionProfile = {"animationRole": "hinge", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["arm"] ?? root).add(node_headHousing_17);
  nodes["headHousing"] = node_headHousing_17;
  const mesh_headHousing_17Geometry = endpoint_headHousing_17
    ? new THREE.CylinderGeometry(endpoint_headHousing_17.endRadius, endpoint_headHousing_17.baseRadius, endpoint_headHousing_17.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_headHousing_17) {
    mesh_headHousing_17Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_headHousing_17 = new THREE.Mesh(
    mesh_headHousing_17Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_headHousing_17.name = "Head housing (pivot)";
  if (endpoint_headHousing_17) {
    mesh_headHousing_17.position.copy(endpoint_headHousing_17.midpoint);
    mesh_headHousing_17.quaternion.copy(endpoint_headHousing_17.quaternion);
  }
  mesh_headHousing_17.castShadow = options.castShadow ?? true;
  mesh_headHousing_17.receiveShadow = options.receiveShadow ?? true;
  mesh_headHousing_17.userData.sculptComponent = {"id": "headHousing", "name": "Head housing (pivot)", "level": "macro", "role": "body", "importance": 0.85, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible pivot at the arm's forward socket, carrying the lens box and mirror flap so the head can tilt as one hinged unit.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "arm", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.66, 0.47, 0.34], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "hinge", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 0.0)", "secondaryAlbedo": "rgba(0, 0, 0, 0.0)", "materialClass": "unknown", "materialClassConfidence": 0.5, "notes": "Invisible container -- alpha 0, never rendered."}};
  node_headHousing_17.add(mesh_headHousing_17);
  meshes["headHousing"] = mesh_headHousing_17;
  colliders["headHousing"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_headHousing_17);

  const endpoint_headLensBox_18 = makeAttachmentEndpoint(null);
  const node_headLensBox_18 = new THREE.Group();
  node_headLensBox_18.name = "Head housing lens box__pivot";
  node_headLensBox_18.scale.set(1, 1, 1);
  if (endpoint_headLensBox_18) {
    node_headLensBox_18.position.copy(endpoint_headLensBox_18.start);
    node_headLensBox_18.rotation.set(-0.3, 0.0, 0.0);
  } else {
    node_headLensBox_18.position.set(0.0, 0.05, 0.05);
    node_headLensBox_18.rotation.set(-0.3, 0.0, 0.0);
  }
  node_headLensBox_18.userData.sculptComponent = {"id": "headLensBox", "name": "Head housing lens box", "level": "meso", "role": "body", "importance": 0.85, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Lower wedge box of the chevron head, angled down-forward, housing the lens barrel and focus ring (image-analysis.md Layer 2/3).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "headHousing", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.42, "height": 0.26, "depth": 0.32, "units": "relative", "confidence": 0.75}, "transform": {"position": [0, 0.05, 0.05], "rotation": [-0.3, 0, 0], "scale": [0.42, 0.26, 0.32]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.42, 0.26, 0.32], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "cream-satin-shell", "materialLayers": ["cream-satin-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"type": "hole or socket", "placement": "front-lateral face, recessed circular cutout", "size": "large relative to box face", "orientation": "front-facing", "materialEffect": "dark interior", "geometryEffect": "modeled via lensBarrel child component", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(230, 221, 201, 1.0)", "secondaryAlbedo": "rgba(242, 236, 224, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'cream-satin-shell' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_headLensBox_18.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.42, 0.26, 0.32], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["headHousing"] ?? root).add(node_headLensBox_18);
  nodes["headLensBox"] = node_headLensBox_18;
  const mesh_headLensBox_18Geometry = endpoint_headLensBox_18
    ? new THREE.CylinderGeometry(endpoint_headLensBox_18.endRadius, endpoint_headLensBox_18.baseRadius, endpoint_headLensBox_18.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_headLensBox_18) {
    mesh_headLensBox_18Geometry.scale(0.42, 0.26, 0.32);
  }
  const mesh_headLensBox_18 = new THREE.Mesh(
    mesh_headLensBox_18Geometry,
    materialMap["cream-satin-shell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_headLensBox_18.name = "Head housing lens box";
  if (endpoint_headLensBox_18) {
    mesh_headLensBox_18.position.copy(endpoint_headLensBox_18.midpoint);
    mesh_headLensBox_18.quaternion.copy(endpoint_headLensBox_18.quaternion);
  }
  mesh_headLensBox_18.castShadow = options.castShadow ?? true;
  mesh_headLensBox_18.receiveShadow = options.receiveShadow ?? true;
  mesh_headLensBox_18.userData.sculptComponent = {"id": "headLensBox", "name": "Head housing lens box", "level": "meso", "role": "body", "importance": 0.85, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Lower wedge box of the chevron head, angled down-forward, housing the lens barrel and focus ring (image-analysis.md Layer 2/3).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "headHousing", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.42, "height": 0.26, "depth": 0.32, "units": "relative", "confidence": 0.75}, "transform": {"position": [0, 0.05, 0.05], "rotation": [-0.3, 0, 0], "scale": [0.42, 0.26, 0.32]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.42, 0.26, 0.32], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "cream-satin-shell", "materialLayers": ["cream-satin-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"type": "hole or socket", "placement": "front-lateral face, recessed circular cutout", "size": "large relative to box face", "orientation": "front-facing", "materialEffect": "dark interior", "geometryEffect": "modeled via lensBarrel child component", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(230, 221, 201, 1.0)", "secondaryAlbedo": "rgba(242, 236, 224, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'cream-satin-shell' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_headLensBox_18.add(mesh_headLensBox_18);
  meshes["headLensBox"] = mesh_headLensBox_18;
  colliders["headLensBox"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.42, 0.26, 0.32], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_headLensBox_18);

  const attachment_lensBarrel_19 = {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0};
  const endpoint_lensBarrel_19 = makeAttachmentEndpoint(attachment_lensBarrel_19);
  const node_lensBarrel_19 = new THREE.Group();
  node_lensBarrel_19.name = "Lens barrel__pivot";
  node_lensBarrel_19.scale.set(1, 1, 1);
  if (endpoint_lensBarrel_19) {
    node_lensBarrel_19.position.copy(endpoint_lensBarrel_19.start);
    node_lensBarrel_19.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_lensBarrel_19.position.set(0.14, 0.0, 0.16);
    node_lensBarrel_19.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_lensBarrel_19.userData.sculptComponent = {"id": "lensBarrel", "name": "Lens barrel", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Recessed dark circular lens barrel on the lens box's front-lateral face (detail-inventory zone-r0c1).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "headLensBox", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.16, "height": 0.1, "depth": 0.16, "units": "relative", "confidence": 0.75}, "transform": {"position": [0.14, 0, 0.16], "rotation": [1.5707963267948966, 0, 0], "scale": [0.16, 0.1, 0.16]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "lens-barrel-dark", "materialLayers": ["lens-barrel-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 40, 42, 1.0)", "secondaryAlbedo": "rgba(20, 21, 22, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'lens-barrel-dark' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_lensBarrel_19.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["headLensBox"] ?? root).add(node_lensBarrel_19);
  nodes["lensBarrel"] = node_lensBarrel_19;
  const mesh_lensBarrel_19Geometry = endpoint_lensBarrel_19
    ? new THREE.CylinderGeometry(endpoint_lensBarrel_19.endRadius, endpoint_lensBarrel_19.baseRadius, endpoint_lensBarrel_19.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_lensBarrel_19) {
    mesh_lensBarrel_19Geometry.scale(0.16, 0.1, 0.16);
  }
  const mesh_lensBarrel_19 = new THREE.Mesh(
    mesh_lensBarrel_19Geometry,
    materialMap["lens-barrel-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lensBarrel_19.name = "Lens barrel";
  if (endpoint_lensBarrel_19) {
    mesh_lensBarrel_19.position.copy(endpoint_lensBarrel_19.midpoint);
    mesh_lensBarrel_19.quaternion.copy(endpoint_lensBarrel_19.quaternion);
  }
  mesh_lensBarrel_19.castShadow = options.castShadow ?? true;
  mesh_lensBarrel_19.receiveShadow = options.receiveShadow ?? true;
  mesh_lensBarrel_19.userData.sculptComponent = {"id": "lensBarrel", "name": "Lens barrel", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Recessed dark circular lens barrel on the lens box's front-lateral face (detail-inventory zone-r0c1).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "headLensBox", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.16, "height": 0.1, "depth": 0.16, "units": "relative", "confidence": 0.75}, "transform": {"position": [0.14, 0, 0.16], "rotation": [1.5707963267948966, 0, 0], "scale": [0.16, 0.1, 0.16]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "lens-barrel-dark", "materialLayers": ["lens-barrel-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 40, 42, 1.0)", "secondaryAlbedo": "rgba(20, 21, 22, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'lens-barrel-dark' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_lensBarrel_19.add(mesh_lensBarrel_19);
  meshes["lensBarrel"] = mesh_lensBarrel_19;
  colliders["lensBarrel"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_lensBarrel_19);

  const endpoint_focusRing_20 = makeAttachmentEndpoint(null);
  const node_focusRing_20 = new THREE.Group();
  node_focusRing_20.name = "Lens focus/knurled ring__pivot";
  node_focusRing_20.scale.set(1, 1, 1);
  if (endpoint_focusRing_20) {
    node_focusRing_20.position.copy(endpoint_focusRing_20.start);
    node_focusRing_20.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_focusRing_20.position.set(0.14, 0.0, 0.2);
    node_focusRing_20.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_focusRing_20.userData.sculptComponent = {"id": "focusRing", "name": "Lens focus/knurled ring", "level": "micro", "role": "detail", "importance": 0.45, "confidence": 0.7, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Large knurled focus ring dominating the lens box's front face, a real ring geometry rather than a flat decal (detail-inventory zone-r0c1).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization", "torusTubeRatio": 0.22}, "parent": "headLensBox", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.2, "height": 0.2, "depth": 0.04, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.14, 0, 0.2], "rotation": [1.5707963267948966, 0, 0], "scale": [0.2, 0.2, 0.04]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "lens-barrel-dark", "materialLayers": ["lens-barrel-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 40, 42, 1.0)", "secondaryAlbedo": "rgba(20, 21, 22, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'lens-barrel-dark' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_focusRing_20.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["headLensBox"] ?? root).add(node_focusRing_20);
  nodes["focusRing"] = node_focusRing_20;
  const mesh_focusRing_20Geometry = endpoint_focusRing_20
    ? new THREE.CylinderGeometry(endpoint_focusRing_20.endRadius, endpoint_focusRing_20.baseRadius, endpoint_focusRing_20.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.099, 24, 96);
  if (!endpoint_focusRing_20) {
    mesh_focusRing_20Geometry.scale(0.2, 0.2, 0.04);
  }
  const mesh_focusRing_20 = new THREE.Mesh(
    mesh_focusRing_20Geometry,
    materialMap["lens-barrel-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_focusRing_20.name = "Lens focus/knurled ring";
  if (endpoint_focusRing_20) {
    mesh_focusRing_20.position.copy(endpoint_focusRing_20.midpoint);
    mesh_focusRing_20.quaternion.copy(endpoint_focusRing_20.quaternion);
  }
  mesh_focusRing_20.castShadow = options.castShadow ?? true;
  mesh_focusRing_20.receiveShadow = options.receiveShadow ?? true;
  mesh_focusRing_20.userData.sculptComponent = {"id": "focusRing", "name": "Lens focus/knurled ring", "level": "micro", "role": "detail", "importance": 0.45, "confidence": 0.7, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Large knurled focus ring dominating the lens box's front face, a real ring geometry rather than a flat decal (detail-inventory zone-r0c1).", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization", "torusTubeRatio": 0.22}, "parent": "headLensBox", "attachment": {"parentSocket": "origin", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0}, "dimensions": {"width": 0.2, "height": 0.2, "depth": 0.04, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.14, 0, 0.2], "rotation": [1.5707963267948966, 0, 0], "scale": [0.2, 0.2, 0.04]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "lens-barrel-dark", "materialLayers": ["lens-barrel-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 40, 42, 1.0)", "secondaryAlbedo": "rgba(20, 21, 22, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "notes": "Matches the 'lens-barrel-dark' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_focusRing_20.add(mesh_focusRing_20);
  meshes["focusRing"] = mesh_focusRing_20;
  colliders["focusRing"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_focusRing_20);

  const endpoint_headMirrorFlap_21 = makeAttachmentEndpoint(null);
  const node_headMirrorFlap_21 = new THREE.Group();
  node_headMirrorFlap_21.name = "Mirror flap__pivot";
  node_headMirrorFlap_21.scale.set(1, 1, 1);
  if (endpoint_headMirrorFlap_21) {
    node_headMirrorFlap_21.position.copy(endpoint_headMirrorFlap_21.start);
    node_headMirrorFlap_21.rotation.set(0.95, 0.0, 0.0);
  } else {
    node_headMirrorFlap_21.position.set(0.0, 0.16, -0.14);
    node_headMirrorFlap_21.rotation.set(0.95, 0.0, 0.0);
  }
  node_headMirrorFlap_21.userData.sculptComponent = {"id": "headMirrorFlap", "name": "Mirror flap", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Upper flap folding back and up from the lens box's rear ridge at roughly 110-120deg, forming the chevron silhouette (image-analysis.md Layer 2, the single most recognizable identity cue per Layer 7). Modeled as one mirror-material box rather than separate frame+mirror-face materials -- the reflective top face dominates the read; see assumptions.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "headHousing", "attachment": {"parentSocket": "lens-box-ridge", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "socket", "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.0}, "dimensions": {"width": 0.46, "height": 0.02, "depth": 0.34, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 0.16, -0.14], "rotation": [0.95, 0, 0], "scale": [0.46, 0.02, 0.34]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "mirror-coating", "materialLayers": ["mirror-coating"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 242, 240, 1.0)", "secondaryAlbedo": "rgba(217, 217, 214, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.85, "notes": "Matches the 'mirror-coating' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_headMirrorFlap_21.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}};
  (nodes["headHousing"] ?? root).add(node_headMirrorFlap_21);
  nodes["headMirrorFlap"] = node_headMirrorFlap_21;
  const mesh_headMirrorFlap_21Geometry = endpoint_headMirrorFlap_21
    ? new THREE.CylinderGeometry(endpoint_headMirrorFlap_21.endRadius, endpoint_headMirrorFlap_21.baseRadius, endpoint_headMirrorFlap_21.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_headMirrorFlap_21) {
    mesh_headMirrorFlap_21Geometry.scale(0.46, 0.02, 0.34);
  }
  const mesh_headMirrorFlap_21 = new THREE.Mesh(
    mesh_headMirrorFlap_21Geometry,
    materialMap["mirror-coating"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_headMirrorFlap_21.name = "Mirror flap";
  if (endpoint_headMirrorFlap_21) {
    mesh_headMirrorFlap_21.position.copy(endpoint_headMirrorFlap_21.midpoint);
    mesh_headMirrorFlap_21.quaternion.copy(endpoint_headMirrorFlap_21.quaternion);
  }
  mesh_headMirrorFlap_21.castShadow = options.castShadow ?? true;
  mesh_headMirrorFlap_21.receiveShadow = options.receiveShadow ?? true;
  mesh_headMirrorFlap_21.userData.sculptComponent = {"id": "headMirrorFlap", "name": "Mirror flap", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Upper flap folding back and up from the lens box's rear ridge at roughly 110-120deg, forming the chevron silhouette (image-analysis.md Layer 2, the single most recognizable identity cue per Layer 7). Modeled as one mirror-material box rather than separate frame+mirror-face materials -- the reflective top face dominates the read; see assumptions.", "geometryDescriptor": {"topologyIntent": "clean-surfaced procedural part, moderate bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals (flatShading:false) -- a real manufactured product's molded plastic/metal shell, not a faceted stylization"}, "parent": "headHousing", "attachment": {"parentSocket": "lens-box-ridge", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "socket", "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.0}, "dimensions": {"width": 0.46, "height": 0.02, "depth": 0.34, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 0.16, -0.14], "rotation": [0.95, 0, 0], "scale": [0.46, 0.02, 0.34]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base-charcoal-shell"}}, "material": "mirror-coating", "materialLayers": ["mirror-coating"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 242, 240, 1.0)", "secondaryAlbedo": "rgba(217, 217, 214, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.85, "notes": "Matches the 'mirror-coating' material's own baseColor/secondary tone 1:1 -- see materials[] and image-analysis.md Layer 5/6."}};
  node_headMirrorFlap_21.add(mesh_headMirrorFlap_21);
  meshes["headMirrorFlap"] = mesh_headMirrorFlap_21;
  colliders["headMirrorFlap"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "display prop only -- no physics"};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_headMirrorFlap_21);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createOverheadProjectorLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Overhead Projector look-dev lights";
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
  lights.userData.lightingFromPhoto = [{"role": "key", "direction": [0.4, 0.85, 0.5], "color": "#f5f0e6", "intensity": 1.3, "notes": "Even, soft studio key from upper-front-left -- reference photo shows minimal cast shadow, consistent with a large soft source."}, {"role": "fill", "direction": [-0.5, 0.4, -0.3], "color": "#dfe3ea", "intensity": 0.5, "notes": "Cool ambient fill lifting shadow-side detail without flattening the form."}, {"role": "rim", "direction": [-0.6, 0.5, -0.6], "color": "#e8bc78", "intensity": 0.45, "notes": "Site's own accent-warm rim (matches the hero's light-cone palette, app/app.css --accent), used consistently across both 3D builds so the projector reads as part of the same visual world as the bust/hero, not a separate studio setup."}, {"role": "environment", "direction": [0, 1, 0], "color": "#ffffff", "intensity": 1.0, "notes": "ACES filmic tone mapping, exposure ~1.0, on a transparent/dark ground; a soft contact shadow beneath the base (ShadowMaterial catcher, matching the bust build's own ground-shadow approach) keeps it from reading as pasted over the page."}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createOverheadProjectorEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameOverheadProjectorCamera(
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
export function createOverheadProjectorPresentationComposer(
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

export function configureOverheadProjectorRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createOverheadProjectorInspectControls(
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
