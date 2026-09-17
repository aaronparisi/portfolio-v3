# Image Analysis — Overhead Projector (reference.jpg)

Single reference photo: classic overhead (transparency) projector, 3/4 front-left angle,
plain white studio background, even lighting, no strong cast shadow. High confidence subject,
no occlusion of any primary macro part.

## Layer 1 — Identification & classification

- **Work type:** overhead projector (classic transparency/AV projector, "boomerang-head"
  archetype common to classroom/office units from the 1980s–2000s).
- **Broad classification:** mechanical/optical tabletop appliance.
- **primaryDomain:** `object`.
- **Confidence:** 0.98 — unambiguous, fully visible silhouette, no competing reading.

## Layer 2 — Overall form & silhouette

- **Base body:** a squat cuboid, rounded-rectangular footprint, all vertical edges filleted
  with a large radius; slightly flares outward toward its lower third (a molded skirt), so the
  base-to-bottom profile is a very shallow, wide taper rather than a constant cross-section.
- **Platen:** a large flat rectangular pane with rounded corners, inset flush within a raised
  bezel/frame that runs the full top perimeter of the base.
- **Vertical arm (post):** a tall extrusion of rectangular cross-section, mounted at the
  base's rear-left corner, rising straight up.
- **Horizontal arm:** a single bent tube/rod, cantilevered from the post's top — rises briefly
  then bends forward-and-right at roughly 90°, terminating under the head housing. Reads as
  one continuous swept curve, not two straight segments with a sharp corner.
- **Head housing:** a wedge/chevron volume — a lower box (holds the lens barrel, facing
  down-forward at a shallow angle) fused to an upper flat mirror panel that folds back and up
  from the same ridge line, at roughly 110–120° from the lower box's face. Side profile is the
  classic "boomerang" silhouette.
- **Symmetry:** the base + platen are bilaterally symmetric about the front-back centerline;
  the arm/head assembly is a single asymmetric appendage mounted at one corner only — the
  whole object is asymmetric overall.
- **Proportion (reference: base width = 1 unit):** base depth ≈ 0.9–1.0×, base height ≈ 0.5×;
  post height above the base top ≈ 1.1×; head housing sits roughly 1.3–1.4× base-width above
  the platen surface.

## Layer 3 — Macro → meso → micro decomposition

**Macro (independent major parts):**
1. Base body (housing)
2. Platen (glass + frame)
3. Vertical arm / post
4. Horizontal arm
5. Head housing (lens + mirror)

**Meso (sub-assemblies):**
- Base → front control panel, left/right carrying-handle recesses, top perimeter bezel, rear
  shell (plain, occluded).
- Platen → glass pane, surrounding raised frame with mitred rounded corners.
- Post → main rectangular extrusion, ruled tick-mark scale strip on its front face, main
  thumbscrew clamp (upper), secondary thumbscrew/lock (lower, near base bracket).
- Horizontal arm → single continuous bent member, no sub-parts.
- Head housing → lower lens box, upper mirror flap, ridge/ hinge line between them.

**Micro (feature groups):**
- Base: two triangular wedge-notch handle recesses cut into the base's vertical corner edges
  (bilateral; corrected from an initial "rounded-rectangle side pocket" guess after the
  close-up detail-inventory scan — see `detail-inventory.json` zone-r2c0), cream-colored
  recessed interior faces against the dark charcoal exterior; rotary control dial + printed
  gradient arc gauge + a separate small round secondary gauge dial with its own red needle;
  small rocker power switch left of the dial cluster; small rectangular label plate near the
  top-left front edge (illegible); two small round nub/fastener shapes near the arm's
  base-bracket corner.
- Platen: concentric fresnel-ring relief molded into the glass underside; thin light-colored
  corner clips at the frame's mitred corners.
- Post: printed ruled/tick-mark scale (measuring-tape style graphic); main blue clamp knob;
  smaller secondary blue/dark knob just below it.
- Head: circular recessed lens barrel with a lighter focus-ring accent; a small blue
  screw/dot on the housing's proximal side (probable lens-rotation lock, low confidence at
  this resolution); flat mirror surface as one unbroken reflective rectangle.

## Layer 4 — Spatial relationships (scene-graph)

- `<platen, embedded-in, base top frame>` — flush, contact type: recessed/framed on all sides.
- `<base top frame, attached-to, base body>` — integral molded shell, contact type: fused.
- `<post, attached-to, base body>` — via a bracket/collar at the base's rear-left corner;
  contact type: socket/clamp.
- `<horizontal arm, attached-to, post top>` — butt/socket joint, bends forward-right from there.
- `<head housing, attached-to, horizontal arm distal end>` — the arm's forward end plugs into
  the underside of the lower lens box; contact type: socket.
- `<lens barrel, embedded-in, head housing lower box>` — recessed circular socket.
- `<mirror flap, attached-to, head housing upper ridge>` — hinge-type joint (fixed angle in
  this photo, real hardware is foldable — noted as inference in Layer 8).
- `<control dial, embedded-in, base front face>` — recessed circular cutout, dial face
  proud of the surface by a small amount.
- `<carrying handles, embedded-in, base left/right faces>` — recessed pockets, not protruding.
- `<thumbscrew knobs, attached-to, post>` — mounted laterally, perpendicular to the post's
  long axis, at two distinct heights.

This is a legitimate case for real `attachment.localStart`/`localEnd` connector geometry
(unlike the earlier bust build, which used it in error): the post→arm→head chain is an actual
multi-segment articulated linkage in the real object, not a single rigid silhouette.

## Layer 5 — Materials & surface (PBR)

| Region | Base color | Metalness | Roughness | Notes |
|---|---|---|---|---|
| Base body shell | dark neutral charcoal-gray | 0 | ~0.7 | matte, low specular |
| Top frame / skirt trim / post / head housing shell | warm off-white / cream | 0 | ~0.45 | satin, visibly glossier than the charcoal body |
| Platen glass | near-colorless, faint warm tint | 0 | ~0.08 | near-specular; concentric fresnel-ring relief molded on underside |
| Mirror panel (underside of head flap) | near-white/silver | 0 (treat as high-reflectivity dielectric coating, not raw metal) | ~0.03 | reads blown-out/bright under studio light |
| Horizontal arm tube | matte dark charcoal | 0 (painted, not raw metal) | ~0.5 | painted metal or plastic-clad tube |
| Control dial / thumbscrews / power switch nub | vivid mid-blue | 0 | ~0.3 | satin-gloss plastic |
| Gradient arc decal | blue→yellow→red printed gradient | — | — | flat unlit print, part of colorMaterialRecipe, not a specular layer |
| Lens barrel | near-black / dark charcoal, mid-gray focus-ring accent | 0 | ~0.4 | semi-gloss |

## Layer 6 — Color & finish

- Base body: neutral dark gray, low saturation, low-mid value, matte.
- Frame/post/head shell: warm off-white/cream, low saturation, high value, satin.
- Platen: near-colorless transparent, faint warm tint at grazing angle, glossy.
- Gradient dial arc: three-stop print — vivid blue → vivid yellow → vivid red/orange-red.
- Knobs/switch: vivid mid-blue, satin-gloss.
- Mirror flap underside: near-white/silver specular highlight.
- Handles/recesses: same dark gray as the body shell (integral, not a separate color).

## Layer 7 — Identity-defining features

- Blue→yellow→red gradient arc gauge on the base's front face — a strong, specific, very
  recognizable identity marker (reads as a lamp-intensity/heat indicator).
- Twin recessed carrying-handle pockets, left/right, rounded-rectangle shape.
- Printed ruled tick-mark scale down the post's front face.
- Two blue knobs on the post at two distinct heights (main clamp + secondary lock).
- Small rectangular label plate near the base's top-left front edge (illegible — modeled as a
  blank plate only, per Layer 8).
- Two small round nub/fastener shapes near the post's base bracket.
- Concentric fresnel-ring texture on the platen glass.
- The chevron/boomerang silhouette of the head housing — the single most recognizable
  "overhead projector" cue, worth getting right over any other single feature.

## Layer 8 — Uncertainty & single-image limits

- **Occluded:** base's rear face (assume plain continuation of the charcoal shell, no vents
  asserted); base underside (assume small rubber feet, not confirmed); interior mechanism
  (lamp/condenser/fan — irrelevant to a static exterior model, not reconstructed).
- **Hidden:** mirror-flap hinge mechanism — angle in this photo is treated as the fixed
  "deployed" display angle; an interactive fold is a designed inference, not a measured one.
- **Uncertain:** exact fresnel-ring spacing/count (approximated from visible spacing, not
  measured optically); label-plate text (illegible, modeled blank); the small blue
  dot/screw on the head housing's proximal side (low-confidence read, may be a rotation lock).
- **Needs another view:** base's right side face is foreshortened by the camera angle;
  assumed mirror-symmetric to the visible left side (same handle recess) as a reasonable
  inference from the object's known bilateral base symmetry, not directly confirmed here.
- **Not modeled:** power cord/plug (not visible in frame, likely rear-mounted or retracted).

## Domain specialization

Layer 1 identifies `primaryDomain: object`, no character/hybrid specialization applies. This
build uses the generic object track end-to-end (no landmarks/anatomy/likeness steps).
