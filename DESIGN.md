# Design

<!-- impeccable:design-schema 1 -->

## World

**Overhead Projector.** The site is staged as a dim classroom lit by a single
overhead projector, mid-lecture. Aaron's own portrait assembles live from a
stack of acetate overlay transparencies — real posterized planes derived
from his actual photo, not an illustration — and the calculus-to-code hero
animation is re-staged as another grease-penciled sheet in that same stack.
There is exactly one theme: a "light mode" would mean turning the room
lights on and losing the premise, so the old light/dark toggle was removed
rather than adapted.

## Palette

One warm family, no teal/purple/second unrelated hue anywhere on the page:

| Token | Value | Role |
|---|---|---|
| `--bg` | `#100e0c` | Classroom-dark ground (warm-neutral, not true black) |
| `--bg-alt` | `#1a1613` | Card/panel fill |
| `--ink` | `#f3ece0` | Primary text |
| `--ink-soft` | `#b8ad9c` | Secondary text |
| `--accent` | `#e8bc78` | Lamp-lit amber — primary accent, CTA fill, links |
| `--accent-warm` | `#a85c3a` | Sienna — secondary accent (alternating slots) |
| `--plane-shadow` | `#2a264a` | Portrait plane: indigo shadow band |
| `--plane-midtone` | `#a85c3a` | Portrait plane: sienna midtone band (= `--accent-warm`) |
| `--plane-highlight` | `#e8bc78` | Portrait plane: amber highlight band (= `--accent`) |
| `--plane-line` | `#14100e` | Portrait plane: ink line work (Sobel edges) |

`--accent` / `--accent-warm` are literally two of the portrait's own plane
colors, reused as the site's accent system — the palette and the hero
image are the same material, not separately invented brand colors.

## Type

- **Display / body:** Space Grotesk — a confident geometric grotesk, no
  serif anywhere (the brief is a lit-room/lecture-hall one, not
  editorial/literary).
- **Annotation (`.annotation`):** Permanent Marker — a genuine grease-pencil
  hand face, used *only* for short emphasis marks ("why?", "the turning
  point", "something") standing in for eyebrow labels and italic emphasis.
  Never used for a headline or body paragraph.
- **Code:** JetBrains Mono — unchanged, the one place monospace is earned.

No eyebrow / kicker labels anywhere on the site (a hard ban, not a
preference) — every section heading carries its own weight.

## Signature asset: the acetate-plane portrait

`public/images/hero-planes/{shadow,midtone,highlight,line}.png`, generated
from Aaron's real photo in two steps documented in
`public/images/hero-planes/README.md`:

1. `scripts/lift-subject.swift` — macOS Vision framework
   (`VNGenerateForegroundInstanceMaskRequest`) isolates the person from the
   background. A genuine on-device ML matte, not a geometric crop or CSS
   mask.
2. `scripts/generate-hero-planes.mjs` — a Playwright/canvas script buckets
   the cutout's real luminance into three flat color bands and derives the
   fourth ("line") plane from real Sobel edge detection on that same
   luminance field.

`PhotoCard.tsx` stacks and staggers these four PNGs into view (sheets
"dropping" onto the platen) and keeps the prior card's pointer-tilt + idle
float physics. This exact slot is where the future `img2threejs` 3D model
will replace the flat portrait, per product decision.

## Motion

- Spring physics throughout (react-spring), gated on `usePrefersReducedMotion()`.
- No CSS bounce/elastic keyframes (`animate-bounce` was replaced with a
  spring-driven loop on the hero's scroll cue) — real objects decelerate
  smoothly, not elastically.
- The light-cone (`.light-cone`) is the page's one real light source,
  anchored at the hero; a slow `.lamp-flicker` opacity drift keeps it from
  reading as a static gradient.

## Retired

- The light/dark `ThemeToggle` and its `data-theme` attribute — replaced
  by the single-theme world above.
- The `.eyebrow` class and every section kicker label.
- Side-tab colored left-borders on `EndorsementCard` and `.pivot-card`
  (flagged by `impeccable detect` as the most recognizable AI-card tell) —
  replaced with a small colored dot mark and a tinted fill, respectively.
- Newsreader (serif) and Inter — this world has no editorial-serif brief.
