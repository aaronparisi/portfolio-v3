# Image analysis — aaron-photo-cutout.png

## Layer 1 — Identification & classification
Work type: portrait bust, adult male head/upper torso. Broad classification: character (human
figure), casual attire. primaryDomain: character. Confidence: 0.95 (clear, well-lit frontal
portrait; uncertainty only from single viewing angle and hair occlusion).

## Layer 2 — Overall form & silhouette
Head: ovoid primitive, widening at cheekbones, narrowing to chin. Hair: irregular volumetric mass
(overlapping toroidal curls) atop/around the cranial ovoid, asymmetric — fuller and higher on
proper-left, receding slightly at both temples. Torso: tapered cylinder (shoulders > waist) in a
loose zip hoodie (soft-body drape, not rigid). Symmetry: bilateral overall with local asymmetry in
curl placement and a very slight head turn. Head:shoulder-width ratio ~1:2.2. Crop: head + neck +
upper torso to roughly mid-torso.

## Layer 3 — Macro -> meso -> micro
Macro: head, neck, torso (hoodie-clad).
Meso (head): cranium/hair mass, face-plate, left ear, right ear (hair-occluded), neck column.
Meso (torso): hood (folded down on shoulders/upper back), zipper track + pull, torso body panel,
partial sleeves, kangaroo pocket (crop cuts it off).
Micro (face): brows (slightly asymmetric arch), eyes (lids, iris/pupil, catchlight), nose (bridge,
ala, tip), philtrum, closed asymmetric smile (proper-right corner higher), jawline, one hoop
earring (proper-left ear), light even stubble.
Micro (hoodie): two white drawstrings with cord-lock aglets, metal zipper pull + teeth, hem
stitching, underarm/chest fabric-slack wrinkles.
Micro (undershirt): teal henley collar, 2-3 visible buttons, coarser-than-hoodie knit texture.

## Layer 4 — Spatial relationships
<hair, overlap, cranium/forehead/temple-skin>. <hood, drape/overlap, torso-behind-neck>.
<zipper-pull, attached-to, zipper-track>; <zipper-track, embedded-in, hoodie-placket>.
<drawstring(L/R), threaded-through, hood> (tethered, hangs freely below attachment).
<henley-collar, visible-through, hoodie-V-gap> (layered beneath). <earring, embedded-in,
proper-left earlobe> (pierced/hoop).

## Layer 5 — Materials & surface (PBR)
Skin: dielectric, warm tan/olive albedo, metalness 0, roughness ~0.55-0.65 (matte-satin), thin
semi-translucency at ear rim/nose. Hair: dielectric, warm golden-brown, metalness 0, roughness
high (matte, fibrous, tight-ringlet relief). Hoodie fleece: dielectric, deep aubergine/wine,
metalness 0, roughness very high (napped, near-zero specular), large soft-fold relief. Zipper +
aglets: metalness ~1, roughness low-mid (satin metal). Drawstrings: dielectric, off-white cotton
cord, roughness high. Henley: dielectric, teal, roughness mid, small near-black dielectric
buttons. Earring: metalness ~1, small bright specular point, silver-toned.

## Layer 6 — Color & finish
Skin: warm orange-tan, mid-high value, low-mid saturation, satin. Hair: amber/gold-brown gradient,
dark-brown roots/underside to bright warm-blonde rim-lit crown (light from above/behind-left).
Hoodie: deep wine/aubergine, low value, low-mid saturation, matte/napped. Henley: teal, mid value,
mid saturation, matte-satin. Drawstrings/aglets: near-white cord vs. small silver metallic caps.
Zipper track: neutral silver, high value, low saturation, metallic.

## Layer 7 — Identity-defining features
Voluminous curly hair, fuller proper-left, receding both temples — strongly identity-defining
silhouette. Asymmetric closed-mouth smile (proper-right corner raised more). Single hoop earring,
proper-left ear only. Light even stubble (not full beard, not clean-shaven). Straight, moderately
thick eyebrows; medium-set eyes with visible upper-lid crease. Straight nose bridge, moderate ala
width, no strong bump/hook (frontal view only). Wardrobe (wine hoodie / teal henley / white
drawstrings) is a specific real outfit, not a face feature — faithful default, reasonable to treat
as swappable later but not for this build.

## Layer 8 — Uncertainty & single-image limits
Occluded: right ear (hair), underside of chin/neck (hoodie collar). Hidden: back-of-head hair
volume, torso below mid-crop (waist/arms/hands — out of scope for a bust anyway), pocket interior,
torso back/sides. Uncertain: exact iris color — reads dark brown/hazel under this lighting; default
to warm dark-brown rather than inventing a lighter shade. Needs another view: true profile/3-quarter
skull depth, ear placement/protrusion, nose profile — single frontal photo can't confirm; the build
will use reasonable, clearly-approximate depth, not invented specificity. Undetermined: precise hair
length at back/sides beyond the visible fringe.
