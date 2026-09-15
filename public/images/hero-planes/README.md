# Hero acetate planes

These four PNGs (`shadow.png`, `midtone.png`, `highlight.png`, `line.png`) are
real derived assets, not a CSS mask or a hand-drawn illustration — they're
generated from Aaron's own photo in two steps:

1. **Subject lift** (`scripts/lift-subject.swift`) — a small Swift program
   using macOS's Vision framework (`VNGenerateForegroundInstanceMaskRequest`)
   to isolate the person from the background, producing
   `aaron-photo-cutout.png`. Same on-device ML behind Preview's "Copy Subject"
   / Photos' subject-lift feature — a genuine matte, not a geometric crop.

   ```
   swiftc scripts/lift-subject.swift -o /tmp/lift-subject \
     -framework Vision -framework AppKit -framework CoreImage
   /tmp/lift-subject public/images/aaron-photo.jpg public/images/aaron-photo-cutout.png
   ```

2. **Posterization** (`scripts/generate-hero-planes.mjs`) — a Playwright/canvas
   script that reads the cutout's real luminance data, buckets it into three
   flat color bands (shadow / midtone / highlight), and derives the fourth
   "line" plane from real Sobel edge detection on that same luminance field —
   the ink linework is measured from the photo, not drawn. Requires
   `playwright` (`npx playwright ...` or any local install):

   ```
   node scripts/generate-hero-planes.mjs
   ```

Regenerate both if `aaron-photo.jpg` changes. The plane colors themselves
(indigo / sienna / amber / ink) live in `scripts/generate-hero-planes.mjs`'s
`PLANES` array and are the same family as `--accent` / `--accent-warm` in
`app/app.css` — change one, change both, so the portrait and the site's
accent system never drift apart.
