import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

// Reverts the hero from the 4-layer acetate-plane treatment back to the
// real photo, warmed to sit under the projector's own light-cone instead of
// reading as a flat sRGB cutout pasted onto a dark background. Same
// Playwright-canvas approach as generate-hero-planes.mjs (no image-processing
// npm dependency) -- draws the cutout once, lifts contrast/saturation
// slightly, then tints with a top-down warm gradient (source-atop, so only
// the subject's own non-transparent pixels are touched) so the light reads
// as falling on Aaron from the same lamp the CSS light-cone glows from,
// strongest at the top of the head and fading by the shoulders.
const IMG_PATH = "/Users/aaronparisi/Desktop/portfolio-site/public/images/aaron-photo-cutout.png";
const OUT_PATH = "/Users/aaronparisi/Desktop/portfolio-site/public/images/hero-tinted.png";
const IMG_B64 = readFileSync(IMG_PATH).toString("base64");

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

// Same bbox-from-alpha square-crop logic as generate-hero-planes.mjs, so the
// tinted photo frames identically to the acetate version it replaces —
// generous padding, biased up slightly (headroom) since shoulders/torso
// fill the lower frame.
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

const padX = (bbox.maxX - bbox.minX) * 0.22;
const padTop = (bbox.maxY - bbox.minY) * 0.18;
const padBottom = (bbox.maxY - bbox.minY) * 0.04;
let cropX = bbox.minX - padX;
let cropY = bbox.minY - padTop;
let cropW = bbox.maxX - bbox.minX + padX * 2;
let cropH = bbox.maxY - bbox.minY + padTop + padBottom;
const side = Math.max(cropW, cropH);
cropX -= (side - cropW) / 2;
cropY -= (side - cropH) / 2;
cropW = side;
cropH = side;

const dataUrl = await page.evaluate(({ crop }) => {
  const img = window.__img;
  const w = 1100;
  const h = 1100;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  // Slight contrast/saturation lift on the base photo -- the site's own
  // dark ground and warm light-cone read as "moody", and a flat, neutral
  // photo looks washed out against it without this.
  ctx.filter = "contrast(1.1) saturate(1.08) brightness(0.97)";
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  ctx.filter = "none";

  // Warm top-down wash, respecting the cutout's own alpha (source-atop only
  // paints over already-opaque pixels) -- amber where the light-cone would
  // actually hit (crown/shoulders), fading to a deeper sienna by the waist,
  // exactly the --accent -> --accent-warm pairing the rest of the site uses.
  ctx.globalCompositeOperation = "source-atop";
  const wash = ctx.createLinearGradient(0, 0, 0, h);
  wash.addColorStop(0, "rgba(232, 188, 120, 0.4)");
  wash.addColorStop(0.35, "rgba(232, 188, 120, 0.16)");
  wash.addColorStop(0.7, "rgba(168, 92, 58, 0.1)");
  wash.addColorStop(1, "rgba(168, 92, 58, 0.05)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);

  // A second, tighter warm pool right at the crown -- the light-cone's own
  // hotspot is a soft ellipse near the top center, not a flat top-to-bottom
  // gradient, so echo that shape instead of only a linear wash.
  const hotspot = ctx.createRadialGradient(w * 0.5, h * 0.32, 0, w * 0.5, h * 0.32, w * 0.55);
  hotspot.addColorStop(0, "rgba(240, 207, 154, 0.3)");
  hotspot.addColorStop(1, "rgba(240, 207, 154, 0)");
  ctx.fillStyle = hotspot;
  ctx.fillRect(0, 0, w, h);

  // Deepen the very bottom back toward the room's own near-black so the
  // portrait settles into the page instead of floating as a bright cutout.
  const grounding = ctx.createLinearGradient(0, h * 0.6, 0, h);
  grounding.addColorStop(0, "rgba(16, 14, 12, 0)");
  grounding.addColorStop(1, "rgba(16, 14, 12, 0.28)");
  ctx.fillStyle = grounding;
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = "source-over";
  return canvas.toDataURL("image/png");
}, { crop: { x: cropX, y: cropY, w: cropW, h: cropH } });

const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
writeFileSync(OUT_PATH, Buffer.from(base64, "base64"));
console.log("wrote", OUT_PATH);
await browser.close();
