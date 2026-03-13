# Preset Ground Rebuild Notes

Status: 2026-03-13 convergence snapshot for the preset ground experiments.

This note is the current design record for the ground work behind
`PresetSun` / `PresetMoon`. It replaces earlier assumptions that were useful
mid-experiment but no longer match the path that actually survived viewer
testing.

## Goal

Keep a visually stable preset ground for `PresetSun` / `PresetMoon` that:

1. does not drift with camera motion,
2. does not shimmer excessively,
3. does not dominate the model visually,
4. keeps repetition acceptable in a free-camera physics viewer.

The target is no longer "make the most dramatic moon look possible". The target
is "pick the most usable preset ground for this viewer and then simplify the
implementation around that choice".

## Current Converged Path

### Chosen asset

The current best asset is:

- `Sandy Gravel` (`2.1m wide` on Poly Haven)

The current preset surface files are:

- `assets/env/preset-ground/sandy_gravel_diff_2k.jpg`
- `assets/env/preset-ground/sandy_gravel_nor_gl_2k.png`
- `assets/env/preset-ground/sandy_gravel_rough_2k.png`

### Chosen backend

The currently preferred backend is:

- `projection: 'infinite'`

This is an important update from the earlier experiment phase. After the pose
source bug was fixed, the original infinite-ground route stopped showing the
worst camera-relative drift. At that point, the backend itself was no longer
the main problem.

### Current preset values

Current preset surface settings:

- `repeat: 0.95`
- `sun.albedoGain: 2.4`
- `moon.albedoGain: 1.2`
- `sun.normalScale: 0.3`
- `moon.normalScale: 0.4`

Interpretation:

- `repeat: 0.95` keeps the effective tile width close to `2 / 0.95 ~= 2.1m`,
  matching the source asset's physical capture width.
- `sun` is intentionally brighter and flatter.
- `moon` keeps more relief than `sun`, but not enough to become theatrical.

## Verified Findings

### 1. The biggest drift bug was pose-source related, not backend-specific

The most destructive movement bug came from anchoring preset ground sampling to:

- `snapshot.scn_pos`
- `snapshot.scn_mat`

For infinite planes, MuJoCo's scene representation can already be recentered in
a camera-relative way. Once preset surface sampling started preferring the
model-space pose:

- `snapshot.xpos`
- `snapshot.xmat`

the obvious "texture chasing the camera" behavior largely disappeared.

This is the most important architectural conclusion from the whole experiment.

### 2. Ground-channel EXR is not worth keeping in this viewer

For preset ground channels:

- `normal`
- `roughness`

converting to `PNG` is the correct practical choice in this repo.

Reason:

- browser-side `EXR` loading for these channels added complexity and instability,
- visual benefit was minor for this use case,
- `HDR/EXR` still matters for sky / environment lighting, not for the ground
  support maps.

### 3. Physical scale matters as much as the texture itself

The experiment confirmed that repetition was often a scale problem before it was
an anti-tiling problem.

Examples:

- `Moon 02` at `repeat = 3.5` was fundamentally wrong because it shrank the
  real capture footprint far below its intended scale.
- `Aerial Beach 01` almost eliminated visible repetition, but looked too low
  frequency and too macro-shaped for a flat physics viewer ground.
- `Sandy Gravel` hit the best balance because its real-world footprint and
  microstructure fit the expected camera behavior much better.

### 4. Material choice mattered more than 2K vs 4K

`Moon 02 4K` did not produce a meaningful improvement over `Moon 02 2K` for
this viewer. The limiting issue was not raw texel count. The limiting issue was:

- visible repetition,
- near-ground plausibility under free camera motion,
- overly characteristic lunar relief drawing attention.

The comparison suggests that texture character and scale fit matter more than
resolution for this feature.

### 5. Current backend comparison outcome

The comparison stage concluded that:

- `chunk-recycle` was useful as a diagnostic experiment,
- it is not the currently chosen primary path,
- it should not drive the next cleanup unless a new requirement revives it.

Why:

- once pose anchoring was fixed, infinite ground no longer exhibited the worst
  drift behavior,
- visible repetition was still largely shared across both routes,
- `chunk` introduced its own boundary / layout concerns without winning enough
  to justify becoming the default today.

After the cleanup pass, `chunk-recycle` is no longer left in the runtime path.

### 6. Viewer suitability beat "hero asset" realism

`Moon 02` can look impressive in curated views, especially in `sun`, but a free
camera physics viewer exposes its weaknesses:

- repetition becomes too obvious,
- near-ground plausibility drops,
- the ground can become a subject instead of a support surface.

`Sandy Gravel` won because it behaves like background infrastructure rather than
like a hero surface.

## Asset Comparison Summary

### Aerial Beach 01

Observed strengths:

- repetition was very hard to notice,
- `sun` looked pleasant,
- large-scale heterogeneity felt natural at a distance.

Observed weaknesses:

- physical footprint was so large that the ground looked under-detailed nearby,
- macro relief suggested dunes / beach undulation more than a flat support
  plane,
- `moon` fit was weak.

Conclusion:

- rejected for the current viewer despite good anti-repetition behavior.

### Sandy Gravel

Observed strengths:

- very low visible repetition,
- slight non-uniformity without stealing attention,
- appropriate "background" role for a physics viewer,
- works in both `sun` and `moon`.

Observed weaknesses:

- lower artistic drama than lunar assets,
- less distinctive identity.

Conclusion:

- selected as the current best default preset ground.

### Moon 02 2K / 4K

Observed strengths:

- strongest "moon regolith" identity,
- compelling in curated views,
- `sun` especially could look very good.

Observed weaknesses:

- repetition remained too obvious,
- near-ground look became less believable in a free camera,
- 4K did not solve the actual problem.

Conclusion:

- keep only as a design reference in this note, not as in-repo preset-ground
  assets.

## Important Implementation Changes To Preserve

These are the pieces worth keeping conceptually even if the files are later
refactored.

### Surface spec and preset tuning

In `environment/environment.mjs`:

- preset ground now uses an explicit `surface` config,
- the chosen path is `projection: 'infinite'`,
- ground brightness and relief are adjusted per preset via:
  - `albedoGain`
  - `normalScale`

### Uniform plumbing and texture binding

In `renderer/pipeline.mjs`:

- preset ground surface params are read from one place,
- `albedoGain` and `normalScale` are pushed through uniforms,
- preset ground surface disables the legacy MuJoCo albedo overlay when active,
- preset ground surface disables infinite-ground fade uniforms while the preset
  surface is active.

### Stable pose resolution

In `renderer/pipeline.mjs` and `renderer/scene_soa_geoms.mjs`:

- preset surface anchoring was changed to prefer model-space geom pose where
  available,
- this is the fix that made the infinite route viable again.

### Ground texture loading policy

In `renderer/scene_soa_geoms.mjs`:

- preset ground texture caching is centralized,
- ground textures are loaded as standard image assets when possible,
- sky HDRI remains separate and still uses HDR/EXR loaders.

### Tests worth keeping

Current high-signal tests are:

- `tests/e2e/environment_asset_base.spec.ts`
- `tests/e2e/preset_ground_surface.spec.ts`

They verify:

- runtime URL rewriting for preset assets,
- actual bound preset texture URLs,
- active repeat / gain / normalScale values,
- preset surface activation on the ground path.

## Cleanup Outcome

The current cleanup removed the following dead experiment paths from runtime:

- dormant `chunk-recycle` plumbing in the renderer,
- preset-ground `detail` channel plumbing,
- preset-ground EXR loading for non-HDRI channels.

What remains intentionally:

- the infinite-ground backend,
- stable pose anchoring,
- anti-tiling and distance-response logic that still affects the chosen path,
- preset-level `albedoGain` / `normalScale` tuning.

## Refactor Decision Guidance

If we refactor next, the goal should not be another big redesign. The goal
should be:

1. keep today's visual result,
2. keep the stable pose fix,
3. keep the explicit preset surface spec,
4. remove dead experiment branches,
5. make the infinite-ground path easier to reason about.

That implies a smaller cleanup target than what this note originally assumed.

The current evidence does **not** justify another backend pivot right now.

## Suggested Next Refactor Scope

Reasonable next scope:

### Keep

- current infinite-ground preset surface path
- `Sandy Gravel` assets and current scale
- surface-level `albedoGain` and `normalScale`
- the pose-source fix
- the current e2e coverage

### Revisit

- whether preset-ground loading can be reduced to a smaller helper
- whether some infinite-ground shader branches are still carrying dead
  experiment logic

### Avoid

- reopening the asset search unless a new requirement appears
- re-litigating 2K vs 4K
- reintroducing view-reactive anti-tiling tricks

## Current Open Questions

- How much of the current shader logic is still necessary now that
  `Sandy Gravel + infinite + stable pose` has been chosen?
- Can the preset ground surface spec be isolated from broader environment logic
  without changing behavior?
