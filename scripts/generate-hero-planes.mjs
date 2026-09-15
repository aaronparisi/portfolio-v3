import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const IMG_PATH = "/Users/aaronparisi/Desktop/portfolio-site/public/images/aaron-photo-cutout.png";
const OUT_DIR = "/Users/aaronparisi/Desktop/portfolio-site/public/images/hero-planes";
const IMG_B64 = readFileSync(IMG_PATH).toString("base64");

// Warm "acetate overlay" palette, darkest plane first (bottom of the stack)
// up to the brightest (top). Deliberately not teal/pink — a lamp-lit, ink-on-
// acetate family: deep indigo shadow -> sienna midtone -> amber highlight ->
// near-black line work drawn last, on top, like a grease-pencil outline.
const PLANES = [
  { name: "shadow", color: [42, 38, 74], threshold: 0.0 },
  { name: "midtone", color: [168, 92, 58], threshold: 0.32 },
  { name: "highlight", color: [232, 188, 120], threshold: 0.58 },
  { name: "line", color: [20, 16, 14], threshold: 0.9, isLine: true },
];

const html = `<!doctype html><html><body>
<script>
window.__ready = false;
const img = new Image();
img.onload = () => { window.__img = img; window.__ready = true; };
img.onerror = () => { window.__ready = "error"; };
img.src = "data:image/png;base64,${IMG_B64}";
</script>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
await page.setContent(html);
await page.waitForFunction(() => window.__ready === true || window.__ready === "error", { timeout: 15000 });
const readyState = await page.evaluate(() => window.__ready);
if (readyState !== true) throw new Error("image failed to load: " + readyState);

// Compute the subject's real bounding box (from alpha) once, share it across planes.
const bbox = await page.evaluate(() => {
  const img = window.__img;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const a = data[(y * canvas.width + x) * 4 + 3];
      if (a > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY, w: canvas.width, h: canvas.height };
});
console.log("subject bbox", bbox);

// Square crop around the subject with generous padding, biased up slightly
// (headroom) since shoulders/torso fill the lower frame.
const padX = (bbox.maxX - bbox.minX) * 0.22;
const padTop = (bbox.maxY - bbox.minY) * 0.18;
const padBottom = (bbox.maxY - bbox.minY) * 0.04;
let cropX = bbox.minX - padX;
let cropY = bbox.minY - padTop;
let cropW = (bbox.maxX - bbox.minX) + padX * 2;
let cropH = (bbox.maxY - bbox.minY) + padTop + padBottom;
const side = Math.max(cropW, cropH);
cropX -= (side - cropW) / 2;
cropY -= (side - cropH) / 2;
cropW = side;
cropH = side;

for (const plane of PLANES) {
  const dataUrl = await page.evaluate(({ plane, crop }) => {
    const img = window.__img;
    const outSize = 1100;
    const canvas = document.createElement("canvas");
    canvas.width = outSize;
    canvas.height = outSize;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, outSize, outSize);
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, outSize, outSize);
    const srcData = ctx.getImageData(0, 0, outSize, outSize);

    const lum = new Float32Array(outSize * outSize);
    const alpha = new Float32Array(outSize * outSize);
    for (let i = 0; i < outSize * outSize; i++) {
      const r = srcData.data[i * 4], g = srcData.data[i * 4 + 1], b = srcData.data[i * 4 + 2];
      lum[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      alpha[i] = srcData.data[i * 4 + 3] / 255;
    }

    const out = ctx.createImageData(outSize, outSize);

    if (plane.isLine) {
      for (let y = 1; y < outSize - 1; y++) {
        for (let x = 1; x < outSize - 1; x++) {
          const i = y * outSize + x;
          const o = i * 4;
          if (alpha[i] < 0.4) { out.data[o + 3] = 0; continue; }
          const gx =
            -lum[i - outSize - 1] + lum[i - outSize + 1] +
            -2 * lum[i - 1] + 2 * lum[i + 1] +
            -lum[i + outSize - 1] + lum[i + outSize + 1];
          const gy =
            -lum[i - outSize - 1] - 2 * lum[i - outSize] - lum[i - outSize + 1] +
            lum[i + outSize - 1] + 2 * lum[i + outSize] + lum[i + outSize + 1];
          const mag = Math.sqrt(gx * gx + gy * gy);
          const a = mag > 0.3 ? Math.min(1, (mag - 0.3) * 3) : 0;
          out.data[o] = plane.color[0];
          out.data[o + 1] = plane.color[1];
          out.data[o + 2] = plane.color[2];
          out.data[o + 3] = Math.round(a * 255);
        }
      }
    } else {
      const idx = plane.__idx;
      const bands = plane.__bands;
      const lo = plane.threshold;
      const hi = idx + 1 < bands.length ? bands[idx + 1].threshold : 1.01;
      for (let i = 0; i < outSize * outSize; i++) {
        const v = lum[i];
        const o = i * 4;
        if (alpha[i] > 0.4 && v >= lo && v < hi) {
          out.data[o] = plane.color[0];
          out.data[o + 1] = plane.color[1];
          out.data[o + 2] = plane.color[2];
          out.data[o + 3] = 255;
        } else {
          out.data[o + 3] = 0;
        }
      }
    }

    ctx.putImageData(out, 0, 0);
    return canvas.toDataURL("image/png");
  }, { plane: { ...plane, __idx: PLANES.indexOf(plane), __bands: PLANES }, crop: { x: cropX, y: cropY, w: cropW, h: cropH } });

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  writeFileSync(`${OUT_DIR}/${plane.name}.png`, Buffer.from(base64, "base64"));
  console.log("wrote", plane.name);
}

await browser.close();
