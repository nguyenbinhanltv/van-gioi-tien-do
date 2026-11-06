# @vgtd/sprite

Frame-by-frame AI sprite-sheet pipeline for Player bodies (D41, `docs/art/sprite-sheet-pipeline.md`).

```
npm run sprite:template -w @vgtd/sprite -- --clip run --frames 12 --cols 6 --gait run --master <master.png> --out <dir>
npm run sprite:build    -w @vgtd/sprite -- --project <project.json> --out <dir> [--allow-errors]
npm run sprite:repair   -w @vgtd/sprite -- --sheet <orig.png> --edited <edited.png> --cell <i> --cols <n> --rows <n> --out <fixed.png>
```

Stages (all exported from `src/index.ts`): `buildTemplate` / `locomotionCells`, `sliceSheet`, `paletteFromMaster` /
`lockPalette`, `calibrate` / `alignFrame` (one fixed scale per character or per sheet, translation only, pre/post
metrics recorded), `packFrames` (<= 2048 pages, padding 2, extrude 1, premultiplied), `buildArmature` (one DragonBones
armature, slot `body`, stepped `displayFrame`, events from the animation table), `runQa` (height +-3 %, foot slide,
loop seam, face/torso similarity, all frames present), `repairCell` (one cell replaced, the rest byte-identical),
`runProject` (the whole chain). Engine-free; images use the `@vgtd/rig` raster / PNG codec.

Directional locomotion: pass `--direction SE` (or S/NE/N) to `sprite:template`, or
`direction` to `locomotionCells`. `facingGroundVector` derives the unit y-down isometric ground
axis from the shared tile projection through the rig API. Ghost stride and the QA displacement
projection use that same axis; foot lift remains vertically upward. Ground speed and view gain
are unchanged. Project builds pass their direction to QA automatically; standalone `QaClip`
callers should set `direction` (default E).

Regenerate old non-E templates with the correct direction. Preserve the template cell's ground
reference with `vertical: "keep"` for clips with y stride; aligning the lowest pixel to a fixed row
each frame removes the ground-plane motion. Non-E QA finds sole-bottom runs near each ghost in
2D, reports missing/off-ghost contacts, and projects consecutive planted displacement onto the
ground axis. Fully occluded feet still require art review. Existing E templates and the E sole
measurement remain unchanged.

Non-E metrics use new IDs: `slide_ground_px_per_frame_L/R` and `ghost_distance_2d_px_L/R`.
Existing x-only `slide_px_per_frame_L/R` and `ghost_offset_px_L/R` entries are not baselines for
these measurements. Re-run QA, review the new values, then explicitly accept them with notes if
appropriate; do not rename or copy old numeric baselines. Stale x-only entries can be pruned after
review. Preserve original template PNGs/manifests and their provenance; save regenerated directional
templates as new generation inputs rather than relabeling old E-shaped ghosts.
