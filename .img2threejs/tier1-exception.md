# Tier-1 silhouette gate: documented exception

**Result:** silhouetteIoU 0.536 against a required 0.85 (aspectRatioDelta/scaleDelta 0.477,
also over their thresholds). bilateralSymmetryError 0.01 — well within tolerance.

**What was tried, with evidence:**
1. Measured the real photo's silhouette width at 7 height slices via its alpha channel
   (`measure-widths.mjs`) rather than guessing. Found the torso taper was built backwards
   (narrow-at-bottom instead of narrow-at-shoulder/wide-at-arms) and rebuilt the
   tapered-sweep stations from those measurements. IoU: 0.076 -> 0.536.
2. Tried correcting torso height to match the measured shoulder-to-crop span exactly
   (1.984 HU vs the authored 1.78 HU). This measured *worse* (0.508), so it was reverted --
   not kept just because it was "more precise" on paper.

**Why this is accepted as a documented exception rather than continuing to chase 0.85:**
- Two rounds of real, evidence-based tuning show diminishing returns (large first gain,
  then a plateau, then a regression on the next attempt).
- The very next pass (form-refinement) rebuilds the hair mass into 8-10 faceted clump
  primitives per reconstruction.md -- one of the two biggest current silhouette mismatches
  (currently a smooth dome) will change anyway, making further blockout-stage silhouette
  tuning against today's geometry premature.
- Closing the rest of the gap would most plausibly need separate arm geometry, which adds
  real component/material scope to what the user explicitly scoped as a simple static bust,
  not a full rigged figure.
- The visual comparison (side-by-side against the reference) is unambiguously recognizable
  as a person with correct rough proportions -- the gate's 0.85 bar is calibrated for
  general object/character reconstruction fidelity, not specifically for "reads correctly as
  a stylized abstraction," and doesn't distinguish the two.
- User-approved: presented the plateau and the tradeoff explicitly; user asked for my
  recommendation, which was to document and proceed, and approved it.

Multi-angle orbit captures (front/orbit-right/orbit-left/orbit-back) confirm the form holds
as a real volume from every angle, not a flat plane faking depth -- see
`.img2threejs/render-capture/` for the four screenshots referenced by this exception.

## Update after form-refinement (hair faceting)

Replaced the single smooth hair-dome ellipsoid with 9 individually-authored, asymmetric
clump primitives (reconstruction.md's preferred approach; not the built-in radial
`repetitionSystems` instancing mechanism, which assumes a uniform circular array and cannot
express the measured left/right asymmetry). Visually this is unambiguously better -- the
hair reads as a real irregular curl mass instead of a bathing cap, with the fuller-left /
receded-right asymmetry now visible.

**silhouetteIoU went DOWN slightly: 0.536 -> 0.522.** The gaps between individual clumps
(negative space at their boundaries) cost a small amount of total silhouette area versus one
solid dome, even though the shape is a closer match to the real hair's character. This is a
concrete, first-hand example of exactly what `self_correction.md`'s "2D Gates Are Blind to
3D Realism" section warns about: a pixel-overlap metric cannot distinguish "a smooth blob
that happens to cover more area" from "a more accurate, more recognizable shape that covers
slightly less." Keeping the faceted hair -- the numeric regression does not reflect a real
quality regression, and continuing to optimize for this specific number would mean reverting
a genuine improvement.
