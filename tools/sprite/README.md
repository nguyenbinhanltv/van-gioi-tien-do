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

## Grouped clip sheets

`buildGroupedTemplate({ clips: [{ name: 'hit', frames: 6 }, { name: 'dash', frames: 10 }], guides })`
returns a maximum 4x4 template and `clips` mappings. Each clip may supply its own `cells` (pose tags/foot ghosts).
Generate those locomotion cells using that clip's duration and direction before grouping.
CLI: `npm run sprite:template-group -w @vgtd/sprite -- --group <group.json> --master <master.png> --out <dir>`.
The group JSON contains `clips` and optional `cols` (default 4); output is `group.template.png`, `group.template.json`,
and `group.clips.json`. The latter contains exact project mappings; add each clip's own timing/events/kind/calibration,
and point `sheet` and `manifest` at the shared generated PNG and full-sheet manifest.

Project clips opt in with `sheetSelection: { rows: 4, cells: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }`.
`cols` describes the whole sheet; `frames` is this clip's count. `cells` are unique zero-based row-major sheet indices
in playback order. Counts, integer bounds and full-manifest dimensions are checked. Without selection, old behavior is unchanged.
`exceptions`, `contacts`, calibration reference frames and QA frame indices remain clip-local (starting at zero).
DPI preparation normalizes the full shared grid before cell selection; provenance records full-sheet hash and selection.
The shared manifest is selected with the same mapping, so ghosts and leading-leg labels cannot leak from another clip.
A 6-frame hit + 10-frame dash fits 4x4. Larger combinations (including smooth hit+die or idle+emote) exceed 16 cells;
choose smaller groups or separate sheets. Grouping saves generation calls, not runtime atlas memory or QA requirements.

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

## Edit-from-master variants

T2–T5 and costumes use image edits of T1 motion sheets. The pipeline verifies declared references and measurements; it does
not call an image model or automatically detect joints. Keep the source PNGs and generation/edit prompts.

Declare `project.variant`:

```json
{
  "kind": "edit-from-master-v1",
  "category": "tier",
  "id": "T2",
  "masterProject": "../T1/project.json",
  "masterProjectSha256": "<64 lowercase hex characters>",
  "masterImageSha256": "<SHA256 of T1 master PNG>",
  "edit": { "tool": "<image edit tool/model>", "prompt": "<exact edit prompt>" },
  "thresholds": { "minSilhouetteIou": 1, "maxJointDistancePx": 0, "minFaceSimilarity": 1 }
}
```

The thresholds above demand exact preservation and are an example, not approved art tolerances. All three are required;
there are no inferred defaults. Record the chosen production thresholds after art review. If T1 uses external preparation
calibration, also pin that file with `masterCalibrationSha256`. Each target clip must declare
`variant: { masterSheetSha256: '<hash of original T1 PNG>', annotations: 'idle.pose-lock.json' }`.
The source must be a non-variant project of the same character/direction. Names, frame counts, duration, loop, table id and
phase anchors, vertical placement, kind, contacts, speed, pose exceptions and every other non-storage clip control must match. Selected template cells/guides and slicing controls also stay locked; the complete clip set must remain present. Master and target require explicit fixed scale (`scale`, preparation calibration, or
`calibration.scale`); inferred reference heights/frames are rejected. Different raw DPI is allowed only with equal output scale. Both projects reference the pinned T1 master PNG; disable palette locking when new outfit colours need to remain unchanged. Variants reuse T1 per-cell alignment origins, so altered clothing centroids cannot shift the anatomy after QA.

The annotations file is an array in clip-local order, one object per cell:

- `master` and `edited`: maps for every `POSE_JOINTS` name, each `{ x, y }` in normalized 256px source-cell coordinates,
  before inset/crop, palette lock and alignment. Review the annotations against the images; copied coordinates do not prove pose identity.
- `face: { rect: { x, y, width, height } }`: one shared integer rectangle containing only the visible face in both cells.
  Face similarity compares premultiplied RGBA differences on the nonempty pixel union; blank face crops fail.
- N/NE only may use `face: { occluded: '<reviewed reason>' }`; this is explicitly **unmeasured**, never a face-similarity pass.

`POSE_JOINTS`: crown (main hair cap), chin, shoulder_L/R, elbow_L/R, hand_L/R, pelvis, knee_L/R, foot_L/R.
Use the same anatomical convention as D44; the existing full-alpha bounding-box QA remains a separate diagnostic.

`npm run sprite:variant-check -w @vgtd/sprite -- --project <project.json>` prints hashes, every cell's metrics and findings;
exit1 means a lock failure. Normal `sprite:build`/batch runs the same audit before alignment/palette lock and includes it
in `.sprite.json`. Silhouette IoU uses alpha>=128; joint gate uses maximum paired distance; face comparison is pixel-based,
not semantic identity recognition. Outfit geometry can change silhouette: calibrate explicit thresholds with reviewed art.
Pose/face findings are hard gates, cannot be accepted into the quality backlog, and receive no pose-exception bypass.
Grouped sheets use each clip's selected cells for both source and edit. Pinning source project/sheet/calibration plus recorded
edited-sheet/annotation SHA256 hashes makes later source drift visible. Hashes prove bytes, not model honesty or image licensing.

### Dynamic upright head evidence (D47)

Smooth-v2 upright defaults include `heightPolicy: 'head-size-v1'`; smooth dash is now upright. Existing projects must adopt
the flag and upright dash explicitly. Ordinary in-band cells without exceptions retain bbox QA; exception/out-of-band cells
need `project.masterHead` and clip-local `headEvidence[index]` with skull `crown`, `chin` and a reviewed `note`.
Use only `posture` or `secondary-overhang` in the matching `exceptions` entry. Generic reasons fail the new upright policy.
Head crown-to-chin Euclidean size must remain within master±3%; any supplied evidence is validated, even on in-band cells.
Keep dynamic run flight tucks, deep dash and lunges when the head scale is correct. There is no crouch band or per-frame fit.

Master landmarks are on the resized256px@2x master. Frame landmarks are on the aligned256px@2x output cell, excluding
secondary hair; grouped sheet indices remain clip-local. From sliced-cell coordinates, apply fixed calibration scale and
contract record.dx/dy. Contract/batch/backlog INFO and expandable review cards retain measurements, coordinates, bbox and
note. Foot errors remain actionable. No automatic head detector or semantic anatomy certification is claimed.
See the Vietnamese pipeline doc for the full authoring contract and migration notes.

### Occluded rear chin (NE/N, D48 amends D47)

Do not fabricate or project a chin. For an occluded rear view, use the same measurement on that direction's locked master
and affected aligned cells:

```json
{
  "kind": "rear-skull-base",
  "crown": { "x": 128, "y": 24 },
  "skullBase": { "x": 128, "y": 61 },
  "breadth": { "left": { "x": 110, "y": 43 }, "right": { "x": 146, "y": 43 } }
}
```

These are illustrative coordinates, not character defaults. `masterHead` belongs to the project's direction-specific
master. Per-cell `headEvidence` uses that shape plus a reviewed `note`, with clip-local keys and aligned output coordinates.
The base is the visible occipital head/neck junction or nape hairline. Both crown-to-base Euclidean distance and maximum
skull breadth (excluding loose hair/ornaments) must be within the same master's±3%. Rear evidence requires breadth and is
restricted to NE/N; mismatched kinds, fabricated chin fields, absent/invalid breadth and scale drift fail.

Existing crown/chin objects remain compatible (`kind` defaults to `crown-chin`). Breadth is optional for front evidence;
when supplied, both master and frame must carry it and it is checked. Master references, kind, sizes, breadth and notes
remain in contract/backlog/review INFO. No bbox, foot or canvas threshold changes and no rescaling are introduced.

### Approved long hair hides the nape (D50 amends D48)

Keep the approved master; do not guess a skull base. For NE/N use the same kind on that direction's masterHead and cells:

```json
{
  "kind": "rear-crown-shoulder",
  "crown": { "x": 128, "y": 24 },
  "shoulderTop": { "left": { "x": 100, "y": 80 }, "right": { "x": 156, "y": 80 } },
  "breadth": { "left": { "x": 110, "y": 43 }, "right": { "x": 146, "y": 43 } }
}
```

Illustrative coordinates only. Measure Euclidean crown-to-shoulder-midpoint and maximum skull breadth, each within the
same-direction master's±3%. Crown excludes hair volume above the skull; breadth excludes loose strands. Shoulder endpoints
must be visible, distinct and inside the cell. Cell evidence adds a reviewed note identifying the approved nape occlusion.
Master points are on its resized256px cell; motion points are on aligned256px output cells, keyed clip-locally.

Chin/skullBase fields are rejected for this kind. INFO review/backlog retain both shoulder endpoints, computed midpoint,
kind and master/frame reference values. No approved master pixels, calibration scale, foot or canvas thresholds change.

## Reviewed authored origins

Optional `clip.authoredOrigins` uses **clip-local** keys, including grouped sheets:

```json
{
  "authoredOrigins": {
    "6": {
      "pelvisX": 118,
      "reason": "Wide lunge: reviewed anatomical pelvis",
      "evidence": "source frame6 pelvis landmark, reviewed against pinned T1"
    }
  }
}
```

Coordinates are on the normalized256px SOURCE cell before slice inset (x right/y down). The pipeline converts by actual
cell pitch, then subtracts inset; this does not alter the fixed calibration scale. pelvisX replaces measured centroid X.
Without groundY, existing sole/keep Y behavior is unchanged. Optional groundY requires vertical keep and the same declared
ground on EVERY clip cell; per-frame ground fitting is rejected. Both reason and human-reviewed evidence are mandatory.
Anatomical pelvis/root evidence must be honest: this is not permission to shift each pose merely to hide an art error.

When overrides are omitted, existing pixels/placement are unchanged. Overrides and applied source point/scale/dx/dy appear as INFO in contract,
backlog CLI and review page. Height/head, foot and canvasLoss gates remain unchanged; incorrect origins can still fail.
Variants inherit the T1 origins and cannot override them. Manual landmarks are not an automatic pelvis detector.

For a lunge with intentional pelvis travel, use `kind: "lattice-root"`, `reason: "preserve authored root travel"`, and
evidence naming the reviewed fixed source/T1 lattice registration axis. The historical `pelvisX` field then stores that
registration X, **not the moving anatomical pelvis**. Declare this same X/kind on every clip cell. This preserves authored
root travel without per-frame fitting; scale/thresholds and the canvas gate remain unchanged. The default kind is
`anatomical-pelvis`; contract/backlog/review explicitly show the supplied kind.

## Weapon extraction and hand QA primitives (D45)

`extractWeaponLayer(full, bodyEdit, grayscaleMatte, cellEvidence, thresholds, { clip, frame })` compares same-sized,
aligned premultiplied cells. The body-only edit removes the weapon and inpaints newly exposed hands/skin; the reviewed matte
uses black/transparent=0, white=opaque, gray=weapon alpha coverage. Difference plus matte recovers visible foreground colour,
including alpha over opaque body when the matte is accurate. It returns body/weapon/recomposed images, per-cell metrics and
hard findings; no model is called and no art threshold is inferred.

Each `ExtractionCell` declares front/back order, visible/hidden status, held/ridden/carried/detached attachment,
requiredAnchors, anchors (`name`, source/body/optional weapon points), integer inpaint rectangles and reviewed note.
Held weapons need hand_L/R contacts; paired gauntlets must declare both. Ridden weapons need foot contacts. Every required
anchor must be present. Detached contacts are explicitly UNMEASURED INFO. Inpaint is bounded around reviewed body contacts.

Explicit `ExtractionThresholds`: differenceThreshold, maxOutsideChangedPixels, maxInpaintAreaPixels,
maxReconstructionChangedPixels, maxMatteError, minWeaponPixels, maxAnchorDistancePx and anchorRadiusPx.
QA checks unrelated repaint, matte feasibility, visible/hidden consistency, source/body/grip alignment and nearby opaque
pixels, plus reconstruction in the declared order. weaponExtraction/handAlignment failures cannot enter the quality backlog.

`qualityGlowLayer(weapon, radius)` emits a neutral white premultiplied halo for runtime quality tinting, without six redraws.
Matte coverage, hidden geometry and new hand anatomy need visual review; differences cannot uniquely identify alpha over an
opaque background or reconstruct unseen weapon/body parts. Unchanged low-contrast matte pixels are reported for review.
These are pixel/contact checks, not semantic anatomy recognition. Canonical guide/export CLIs follow in a separate change.

## Canonical layer-edit references

```sh
npm run sprite:layer-template -w @vgtd/sprite -- --project path/to/project.json --out /tmp/layer-guides
```

Run only after the source project's QA passes, including canvas loss and backlog regression checks. The command writes
transparent `source-N.full.png` sheets and `layer-inputs.json` with SHA256 project/master/guide hashes and clip-to-cell maps.
Guides are canonical 4x4 at256px per cell (1024square); they copy exact aligned output pixels, never fit or realign poses.
Original sheet grouping is retained, flattened into the canonical lattice. Conflicting versions of a shared cell fail.

Use these exact full-pose references for AI weapon-removal edits: preserve all body/face/pose pixels and scale, remove only
the weapon, inpaint exposed hands/skin, and retain the lattice. Produce a reviewed grayscale weapon-alpha matte separately.
Declare returned DPI for subsequent whole-sheet normalization; do not align body and weapon independently. Paired gauntlets
belong to the weapon set and need both hand contacts. Keep the original full-pose sources as provenance.

`prepareLayerSources`/`writeLayerTemplates` are public APIs. `runProject(..., { includeAlignedFrames: true })` optionally
retains aligned images in memory; default calls and serialized export files are byte-compatible. Independent layer-set
export follows separately; this command produces edit references only.

## Independent layer-set export (D45)

```sh
npm run sprite:layers -w @vgtd/sprite -- --project path/to/layer-extraction.json --out /tmp/layers-E-attempt1
```

`LayerExtractionProject` is exported publicly. Its header is `format: 'vgtd-layer-extraction'`, `version: 1`, source
`project`/`projectSha256`/`masterImageSha256`, shared T1 `motionId`, distinct `bodySet`/`weaponSet`/`fxSet`, `glowRadiusPx`, and explicit
`ExtractionThresholds`. Every source clip must appear once in `clips`, declaring `name`, canonical `templateSha256`,
`bodySheet`/`bodySheetSha256`, `weaponMatte`/`weaponMatteSha256`, edit `{tool,prompt}` and clip-local `cells: ExtractionCell[]`.
File paths are relative to the extraction JSON. Use `layer-inputs.json` for the project/master hashes, canonical guide and cell map.
Its `cells` indices refer to the canonical4x4 lattice, including when the original source grid had another column count.

Body edits and mattes are normalized as whole4x4 sheets; every selected output cell retains the original aligned pose,
scale and origin. The removal edit is keyed with the source settings but receives no palette/spill/defringe cleanup that
could hide repaint. Matte values are reviewed grayscale alpha coverage. Hand/contact anchors and inpaint rectangles use
the canonical256px cell. Front/back order is explicit for every weapon frame, including hidden ones.

The command rechecks source QA and pins source project/master/full sheets, guide, body edit and matte hashes. Reports retain
edit provenance, preparation records, all per-cell evidence/metrics and hard findings. Failure writes diagnostic reports
only and exits1. Use a fresh output root per attempt; an existing same-direction report/manifest is rejected to avoid stale
runtime files. Distinct directions may append to one set root. `layer-report_<DIR>.json` retains each direction and
`layer-report.json` is the latest summary.

Passed output contains `<setId>/<setId>_<DIR>.layer.json` plus independent PMA MaxRects atlas pages. Body, weapon and neutral
quality-glow FX retain source duration, loops, every drawn frame and body-owned events. A too-short30Hz timeline that would
drop drawings fails. FX declares `derivedFromWeapon`; weapon skins map to their matching FX or explicit null. For tiers,
costumes and weapon skins, use edit-from-master variants (`category: 'tier' | 'costume' | 'weapon-skin'`) so the same pose,
face, motion and origin locks apply before extraction. Do not generate body×weapon Cartesian products.

Public APIs: `runLayerExtraction`, `writeLayerExtraction`, `buildSpriteLayerSet`. The last API packs already aligned layer
images; callers must retain authoring QA. Stage passed set directories beneath the Cocos equipment resource root, then use
the mapping/preview contract in `apps/client-cocos/LAYERED-SPRITES.md`. These pixel/contact gates do not certify unseen
geometry or inpaint anatomy; mattes and thresholds need real-art review, as recorded in OPEN-ITEMS.

### D53: one shoulder endpoint occluded on the locked rear master

NE/N may use `kind: 'rear-crown-shoulder-single'` only when one shoulder endpoint is genuinely hidden on the approved
master. Prefer D50 when both endpoints are visible. Record `crown`, one visible `shoulderTop: {x,y}`, mandatory skull
`breadth: {left,right}`, `occludedSide: 'left' | 'right'`, and a concrete `occluder` string containing `fan`, `hair` or
`ribbon`. Frame evidence uses the same kind/occluded side and adds a reviewed `note`; generic `hidden`/`unknown` reasons fail.

The size is the positive **vertical** difference `shoulderTop.y - crown.y`, not the diagonal length. Skull breadth remains
Euclidean. Both must match the same-direction master within the unchanged head tolerance. Coordinates are resized256px
on the master and aligned256px in motion cells, using clip-local indices. Never project a hidden shoulder/chin/skull base,
edit the approved master, or substitute a convenience point. If a frame also hides the remaining shoulder, report it
instead of supplying invented evidence. INFO/review retains the visible point, occluded side/reason, and master values;
foot/canvas gates and fixed scale remain unchanged.
