# Material evidence: skipped

Reason: this build uses flat, per-material palette colors (`materials[].baseColor`) drawn from the
site's own acetate-plane palette, never texture-extracted PBR maps from the source photo — a
committed stylization choice recorded in `lookDevTargets.materialPass.referencePbrExtraction`
(`requiredWhenSourceImagePresent: false`) and on every material's own `notes` field. Running
`material_region_analysis.py` / `extract_pbr_evidence.py` against the photo would produce albedo/
roughness/normal maps this build has no use for and no slot to wire in (`textureProjection.mode`
is `"none"` on every material). Real color values were instead read directly from
`image-analysis.md`'s Layer 5/6 (materials & surface, color & finish) observations and re-mapped
onto the 4-color palette by hand, which is the actual material-authoring step for this build.
