# Projection route decision — overhead projector

**Decision: SKIP texture projection.**

Reasoning:
- Every visible surface is a flat, evenly-lit, near-solid color region (charcoal shell, cream
  shell, blue plastic, printed gradient decal) or a procedurally-describable optical surface
  (clear platen glass with fresnel relief, mirror panel). None of these need photo-derived
  albedo/normal/roughness maps extracted via `solve_camera_pose.py` / `delight_albedo.py` /
  `bake_projected_texture.py` — they are fully specifiable as PBR scalar/color values plus a
  small number of procedural local overrides (fresnel ring relief, ruled tick-mark decal,
  gradient arc decal), the same `textureless.declared` approach used successfully for the
  earlier bust build.
- The one genuinely graphic surface (the blue→yellow→red gradient arc + secondary gauge dial
  on the base's front face) is better represented as an authored gradient/decal recipe tied to
  UV-space coordinates on that one face than as a projected bake from a single 3/4-angle photo
  that never shows the face perfectly head-on (would bake in perspective distortion).
- No part of this object requires matching a photographed likeness pixel-for-pixel (unlike a
  character face) — it only needs to read unambiguously as *this class* of overhead projector
  with its specific identity markers (gradient dial, ruled post scale, chevron head, fresnel
  platen), which the color/material recipe route handles directly.

Proceeding straight to spec authoring with hand-specified materials, following
`material-evidence-skip.md`-equivalent reasoning (recorded at the material-evidence step).
