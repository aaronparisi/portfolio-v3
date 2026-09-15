# Reference suitability verdict

**Verdict: character-conditional -> stylized**

- Humanoid subject, one clear, well-lit frontal view, pose readable (neutral, near-camera-facing,
  slight turn). Hair and cloth are present and clearly a stylized-clump/fold-normal treatment is
  the intended target, not photoreal strands or drape simulation.
- Stylization level confirmed with the user ahead of this build: **low-poly / faceted geometric**,
  built from flat color planes in the site's own acetate palette (indigo/sienna/amber/ink) rather
  than realistic shading — this is a stronger match to "stylized" than to "realistic ~7.5 heads,"
  and doesn't require photoreal skin/hair microstructure the single image couldn't support anyway.
- Not maximum-likeness: the user explicitly chose the faceted-plane treatment over a photoreal bust
  in the direction discussion, so per-region confidence reporting and multi-view requests for
  exact likeness matching don't apply here — likeness is still the goal (recognizable as Aaron),
  just through low-poly faceting rather than projection-mapped photoreal texture.
- Single-view limits (back/sides of head, ear placement depth, nose profile) are accepted as
  reasonable-approximation territory per Layer 8 of the image analysis — consistent with a
  stylized low-poly bust, where exact depth fidelity was never the goal.

Proceeding through the standard character pipeline (`grimoire/character/reconstruction.md`), not
`likeness_maximization.md`'s projection-first track.
