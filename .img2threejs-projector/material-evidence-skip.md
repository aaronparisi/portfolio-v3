# Material evidence: skipped, with reason

All 8 planned materials (base-charcoal-shell, cream-satin-shell, platen-glass, mirror-coating,
arm-painted-metal, control-blue-plastic, gradient-decal, lens-barrel-dark) are flat or
near-flat PBR regions directly readable from the single reference photo's even studio
lighting — no extracted PBR map analysis (`material_region_analysis.py` /
`analyze_texture.py` / `extract_pbr_evidence.py`) adds value over hand-specified
albedo/metalness/roughness values plus `textureless.declared` evidence, the same route used
for the earlier bust build's flat acetate-palette materials.

Materials will be authored directly by hand in `object-sculpt-spec.json`, each carrying its
own `textureless.declared: true` with an `evidence` array pointing at the relevant
image-analysis.md Layer 5 row and detail-inventory zone crop.
