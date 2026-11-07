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

For non-E templates, measure the full stance width from the master and pass `stanceWidth` in
texture pixels (`sprite:template --stance-width <px>`). R/L lanes are offset by +width/2 and
-width/2 along the perpendicular `(-axis.y, axis.x)`. Zero retains the old centre-line layout;
it does not infer anatomical foot separation. Keep the E default width zero for its legacy detector.

Regenerate old non-E templates with the correct direction. Preserve the template cell's ground
reference with `vertical: "keep"` for clips with y stride; `runProject` rejects measured non-E
clips with template cells unless this is explicit. Aligning the lowest pixel to a fixed row
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

Legacy migrations may explicitly set `footSlideUnmeasuredReason` on a clip. A nonempty reason
skips only foot-slide measurement and emits an `UNMEASURED` info finding (no numeric metric).
Other hard gates still run. Matching old foot-slide baselines are neither resolved nor pruned;
batch/review marks the clip as a warning with an unmeasured label. The committed Dan/Phu and Kiem tu SE
walk/run clips use this temporary opt-out until their art owner migrates separate directional
QA guides and reviewed baselines; original generation inputs remain unchanged. Remove the
opt-out only after setting `vertical: "keep"` and completing that migration.

MaxRects tries one page first and emits additional pages only on overflow, without rotating,
downscaling or dropping frames. Each page stays within the atlas budget. The first page retains
`<stem>_<DIR>_tex.json/png`; additional pages use `<stem>_<DIR>_page1_tex.json/png`, etc.
Multi-page contracts add `atlas.textures`, an ordered list of extensionless resource stems
(primary first). Single-page exports omit it and remain byte-stable.

The Cocos actor loads all pages before building the same single armature. It registers extra
pages through public `CCFactory.parseTextureAtlasData` under the primary atlas asset UUID,
deduplicating shared registrations. The skeleton retains all displays, original geometry and
clip-table events; each atlas JSON contains only its own regions. Memory reporting sums every
texture. Copy the complete output folder (including `.sprite.json`); `sprite:batch --capture`
stages all files automatically and resolves its repository from the original launcher entry.

Quality backlogs keep measured acceptances in `entries` and optional visual observations in `manual`:

```json
{
  "kind": "carry_change",
  "clip": "run",
  "dir": "E",
  "cells": [6, 7],
  "severity": "warn",
  "reviewer": "art-worker",
  "note": "Sword carry changes during the second half of the cycle."
}
```

Manual kinds: `carry_change`, `weak_reversal`, `redraw_drift`, `hair_spill`, `other`.
Cells are zero-based; `[]` covers the whole clip. Severity is a nonempty art-review label (the existing
companion uses `warn` for visible defects and `info` for unconfirmed diagnostics). These observations
are displayed and counted separately in `sprite:backlog` and batch-based `sprite:review`; they do not
accept automatic failures, affect the metric build gate, or enter the automatic resolved list.
`--accept` and `--prune` preserve them. Remove or revise them only after art review.
Optional `status` (`open`, `planned`, `resolved`; default `open`) records only explicit art-worker
review. Automatic QA never changes it, and manual resolutions are displayed separately from metric resolutions.

Migrate worker 17's `vgtd-manual-art-findings` v1 companion without rebuilding art:

```sh
npm run sprite:backlog -w @vgtd/sprite -- --backlog <quality-backlog.json> --import-manual <manual-art-findings.json>
```

The character must match. The import keeps existing metric entries, maps `leg_reversal` to
`weak_reversal` and `key_spill` to `hair_spill`, and maps other unknown kinds to `other`.
It accepts `cell` with `cellConvention: "0based;-1wholeclip"`, or an explicit `cell0based`;
`-1` becomes `cells: []`. Explicit art status is preserved; legacy kind, metric, value, limit and status are retained in note text,
never synthesized as QA findings. Exact reimports do not duplicate observations. The JSON and its
Markdown view are written; source companion files are unchanged. Re-run `sprite:batch` before
`sprite:review` to refresh manual observations in existing batch reports.

## Reproducible mixed-DPI source projects

Raw mixed-DPI grids can declare `"preparation": { "kind": "square-cell-dpi-v1", "calibration": "../character-calibration.json" }` in `project.json`. The calibration JSON supplies a positive finite `scale` shared by every direction. `sprite:build`, `sprite:batch`, and backlog commands use the same preparation automatically; no external assembler or temporary absolute paths are required. An explicit conflicting project `scale` is rejected.

This version matches the original Dan/Phu assembler: remove external blank black/transparent top/bottom rows only when needed to recover square cells (1px cell-grid tolerance, 3px crop rounding), resize the entire grid to `CELL_PX` cells, then apply the locked character scale. This is an explicit sheet DPI conversion, never a per-frame fit or atlas downscale. Non-square content and missing/invalid calibration fail as **non-reproducible project** before art QA. Sheets already normalized by an external assembler must omit `preparation`.

Prepared contracts retain `sheetSha1` for the normalized PNG and add each clip's `preparation` with `rawSha1`, raw/normalized dimensions, crop bounds, and DPI scale factors. Original sheets, generation guides, phases, pose annotations, and backlog remain unchanged. Projects without preparation retain the existing export format. The committed-project audit validates preparation and rejects undeclared mixed sheet DPI without per-sheet calibration; it does not label raw normalization errors as art findings.

### Semi-chibi smooth profile (D46)

Use `--profile smooth-v2` with `sprite:template`, and spread `smoothProjectClipDefaults(name)` into each project clip.
The legacy APIs remain unchanged. `SMOOTH_SPRITE_CLIPS` provides the official counts, duration and inherited table anchors;
`smoothPoseTags` provides attack anticipation/strike/impact/impact_hold/follow_through labels.
The first attack remains named `attack` at runtime. Draw every cell; do not duplicate poses to meet the count.
Nominal playback is 24 fps, duration = drawings / 24, quantized by the existing 30 Hz export clock (at most half a tick).
Event phases remain in legacy TABLE coordinates. This is presentation timing, not a simulation/balance change.
Maximum lattice: 4x4; logical cells remain 256 texture pixels at 2x. A raw 2048-square 4x4 sheet has 512-pixel cells:
declare DPI preparation and the locked character calibration. Regenerate locomotion ghosts using the new duration.
See `docs/art/sprite-sheet-pipeline.md` for counts and the production contract.
