# @vgtd/sprite

Frame-by-frame AI sprite-sheet pipeline for Player bodies (D41, `docs/art/sprite-sheet-pipeline.md`).

### Optional warm-magenta edge cleanup

`slice.spill.asymmetric` extends `despillInterior` to asymmetric red/blue contamination that the legacy
balanced-magenta test rejects. Example: `"spill": { "asymmetric": { "maxImbalance": 80, "edgeRadius": 2 } }`.
Both fields are required: `maxImbalance` is the maximum absolute red/blue channel difference (0..255), and
`edgeRadius` is an integer >=1 measured in **input raster pixels**. With single-pass resampling this is native
sheet DPI; with the legacy path it is the already normalized raster. Review the radius when changing resampling.

Only the additional asymmetric candidates within that 8-neighbour distance of alpha <128 or the outside
canvas are eligible. The existing threshold, strength and master-palette protection still apply. Alpha and
geometry are untouched. Omit the option to retain the exact legacy output; its balanced-magenta interior
cleanup remains unchanged even when the extension is enabled. The extension preserves asymmetric interior
pink beyond its radius, but it cannot distinguish a legitimate pink accent at the edge from contamination:
keep approved pink/purple palette colours protected and inspect the result. Do not use a broad radius to
conceal repaint, change matte evidence, or certify source/pose defects as fixed.

### Optional single-pass resampling

`sprite:build --resample bilinear|lanczos3|area` overrides `project.resample`. Omitted or explicit
`bilinear` keeps the existing two-pass DPI/placement path and bytes. Nothing opts in automatically.
`lanczos3` uses an antialiased three-lobe sinc kernel; `area` integrates pixel coverage. Both operate on
premultiplied colour, clamp ringing to valid premultiplied pixels, and sample transparent outside the image.

With `square-cell-dpi-v1` preparation, the new modes crop the safe external letterbox and retain native cells.
The native-to-logical DPI transform is composed with the locked character scale and placement in **one geometric
resampling pass**. There is no resized/quantized 256-cell intermediate. A separable filter uses floating-point
convolution rows internally. Authored origins, calibration, template coordinates and canvas-loss records remain
in logical units; native cell-boundary/inset rounding is mapped explicitly. No frame is fitted to its own height.
Keying, despill and palette processing therefore happen at native DPI in this path, before the final resampling.

Public APIs: `normalizeSheetDpi(raw, cols, frames, { resample, defer: true })` returns native cropped pixels and
the intended DPI record; omit `defer` to resample immediately. `alignFrame` accepts `resample` and optional
`sourceTransform` (native cropped pixels to logical cropped pixels). `placeScaled` accepts the method as its last
argument. Deferred preparation/source transforms require a new mode. Contracts record non-default `resample`
and `preparation.singlePass`; `sheetSha1` hashes the retained native preparation PNG in this path, while `rawSha1`
still pins the original source. Standalone normalization without deferral records its chosen method.

Opting in changes pixels, edge measurements and hashes: rerun every QA gate, review head landmarks and matte
edges, and capture Cocos again. Filtering cannot restore missing source detail or certify an art defect as fixed.
Use the same setting for a T1 project and its cosmetic variants. Existing art/export files are not changed by this option.

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

D54: head reasons (`posture`, `secondary-overhang`, and reserved `rear-*`) never skip face/torso similarity. Reviewed D41
pose reasons (bow, seated, collapse, lunge, recoil, raised-sword) keep their existing crop exemption on **any clip kind**,
including upright emote. Head evidence alone never grants that exemption; a cell that also has a separate D41 pose
reason is exempt only via that pose reason. Head reasons still affect only their own height/evidence check; foot/canvas
gates and thresholds are unchanged. D54 changes only head reasons, not legacy non-head exception handling.

Report-only audit of previously skipped merged cells (no source, export or backlog writes):

```bash
npm run sprite:audit-head-similarity -w @vgtd/sprite -- --root assets-src/placeholder --out /absolute/artifact/path/head-reason-similarity-audit.json
```

The command compares every old truthy exception against the new exemption predicate and audits every old-skipped/new-checked
cell, regardless of kind. It removes only those entries in memory, reruns QA and lists fresh similarity results per
clip-local cell; retained D41 pose exemptions are inventoried separately and are not called passes. JSON pins project/master/calibration/sheet/manifest/backlog hashes and gate source
hashes; all inputs are rehashed after each run. A companion Markdown report is written beside the JSON. Output must be
outside the source tree and may replace only an earlier audit report. Similarity failures are reported, never accepted;
unmeasured cells make the command exit nonzero. Run against the intended merged checkout and retain its commit reference.
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

## Rigid ornament hides the N crown (D52 supplements D47/D48/D50)

Keep the approved master. Do not call a side/under-ring edge the crown or project a hidden crown. Only N with genuine
rigid-ornament crown occlusion may use `rear-base-ornament`; soft hair volume is not an anchor.

```json
{
  "kind": "rear-base-ornament",
  "ornamentAnchor": { "x": 128, "y": 28 },
  "anchorDefinition": "Lowest visible point where the rigid bun ring meets hair; the ring hides the crown",
  "skullBase": { "x": 128, "y": 61 },
  "breadth": { "left": { "x": 110, "y": 43 }, "right": { "x": 146, "y": 43 } }
}
```

Illustrative coordinates only. The direction's `masterHead` defines one fixed rigid anchor. Per-cell `headEvidence` uses
this shape, the same nonempty `anchorDefinition`, and a reviewed `note`. Both base-to-anchor Euclidean distance and maximum
skull breadth must be within the locked N master's ±3%. The base is the visible nape/occipital junction, not the collar.
Master points are on its resized256px cell; motion points are on aligned256px output cells with clip-local indices.

Crown/chin/shoulderTop fields, missing or changed definitions, missing breadth, invalid coordinates, wrong direction/kind,
and either size drift fail. Review INFO shows the anchor definition and master/frame landmarks and measurements. A human
must verify that the crown is occluded by a rigid ornament and that the chosen point is its lowest visible hair contact;
this is not automatic semantic certification. Existing head kinds, fixed scale, exception rules and foot/canvas gates stay unchanged.

### D53: one shoulder endpoint occluded on the locked rear master

NE/N may use `kind: 'rear-crown-shoulder-single'` only when one shoulder endpoint is genuinely hidden on the approved
master. Prefer D50 when both endpoints are visible. Record `crown`, one visible `shoulderTop: {x,y}`, mandatory skull
`breadth: {left,right}`, `occludedSide: 'left' | 'right'`, and a concrete `occluder` string containing `fan`, `hair` or
`ribbon`. Frame evidence uses the same kind/occluded side and adds a reviewed `note`; generic `hidden`/`unknown` reasons fail.

The size is the positive **vertical** difference `shoulderTop.y - crown.y`, not the diagonal length. Skull breadth remains
Euclidean. On both master and frame, the visible shoulder must lie strictly opposite `occludedSide` relative to the skull
midline `(breadth.left.x + breadth.right.x) / 2`: right of it for an occluded left shoulder, left of it for an occluded right
shoulder. A point on the midline or declared occluded side fails. Its absolute horizontal offset must also be within
**0.25–1.25 skull breadths**, inclusive, on both master and frame; the real NE master is about0.43 breadths from the
midline. This placement check does not identify shoulder anatomy;
source review must still reject hands, fan tips and other convenience points. Both measurements must match the
same-direction master within the unchanged head tolerance. Coordinates are resized256px
on the master and aligned256px in motion cells, using clip-local indices. Never project a hidden shoulder/chin/skull base,
edit the approved master, or substitute a convenience point. If a frame also hides the remaining shoulder, report it
instead of supplying invented evidence. INFO/review retains the visible point, occluded side/reason, and master values;
foot/canvas gates and fixed scale remain unchanged.

### D56: hidden shoulder in a dynamic rear lean

Frame-only `rear-breadth-only` is restricted to NE/N `dash`, `run`, `attack`, `attack_2`, or
`attack_3` cells declared `posture`. Use it only when the shoulder corner is genuinely hidden but the
frame's own skull-cap crown and both skull-breadth endpoints are visible. Record the concrete shoulder
`occluder` and a reviewed `note`; exclude hairpins, tassels, earrings and loose strands from all three points.
The gate samples alpha >=128 at the rounded crown/endpoints and master breadth endpoints. Hair identity,
true extrema and shoulder occlusion require source review; alpha alone cannot prove anatomical identity.

Keep the same-direction master and its existing full `masterHead` kind unchanged. The frame may use:

```json
{
  "kind": "rear-breadth-only",
  "crown": { "x": 149, "y": 59 },
  "breadth": { "left": { "x": 135, "y": 76 }, "right": { "x": 188, "y": 76 } },
  "occluder": "head+earring in deep dash lean",
  "note": "Reviewed visible skull-cap hair crown and breadth; shoulder corner occluded"
}
```

Compare only Euclidean skull breadth with the locked master's breadth, within the unchanged 3% band.
There is **no vertical span**: omit shoulder/chin/skull-base/ornament anchors, and never project a hidden point.
INFO and review preserve crown, endpoints, occluder, master breadth and ratio; `sizePx`, `masterSizePx`,
and the span `ratio` are absent. Idle/walk/emote/cast, missing occluders, invisible points, or non-posture
reasons fail even when the bbox is in band. D54 similarity still runs; D55 crops apply when merged.
Do not redraw the dynamic pose or reclassify a similarity failure to bypass QA. Phap tu NE dash4/5/7
may adopt this only after D56 merges. Other head kinds and foot/canvas/scale gates are unchanged.

### D55: Lab identity gate and temporal diagnostics

D55 replaces the hard 8x8 L1 similarity score with Lab palette identity: head distance<=15, torso distance<=23.
L1 remains diagnostic. Temporal SSIM below 0.45 is `review-by-eye` INFO, never a hard failure; mirror coverage combines
that flag with mandatory visual contact-sheet review for every direction PR. The existing 3% head-size band controls
scale. D41 pose exemptions and D54 head-reason scope are unchanged. Static-master SSIM failed pose calibration and is
retained only as a historical diagnostic. No frames are fitted or repainted to satisfy a similarity metric.

Both windows use actual supplied landmarks. Front spans crown to chin, with width equal to annotated breadth or one
Euclidean head length when breadth is absent. Rear is labelled `rear-head`, using existing endpoints and breadth;
shoulder spans are capped at one breadth below the top, and D52 uses its existing ornament anchor. D56 pairs use crown
to crown plus each side's breadth, including the locked D53 master. Temporal D56/D53 pairs use that same window rule.
Head windows expand 8% total per dimension (4% per edge). Torso starts at the padded head bottom, has depth 25% and
width 44% of master figure height, and is centred on front chin x or rear window x. These windows never create evidence.
Missing either side's points uses paired centroid windows, flagged `centroid-fallback`. Invalid points are not hidden.

A uses opaque pixels (alpha>=250), unpremultiplies RGB, converts sRGB through linear RGB/XYZ to CIELab relative to D65,
and normalizes one-unit histograms of L, a and b. Per-axis 1-Wasserstein distances are combined with a Euclidean norm;
chroma distance is also reported. This is a marginal-distribution distance in Lab units, not per-pixel DeltaE or CSS
lab(D50). The fixed hard ceilings are 15 (head) and 23 (torso). Spatial rearrangement and transparent RGB do not affect it. Missing opaque samples are explicitly unavailable,
not zero distance or pass. Source for colour-space equations: https://www.w3.org/TR/css-color-4/#color-conversion-code.

B computes Wang et al. (2004), Eq.13 SSIM on native-pixel BT.601 premultiplied luminance, with K1=0.01, K2=0.03, L=255.
Each window is a statistical sample, not an 8x8 reduction. A shared physical-pixel canvas centres paired windows without
resizing them; bilinear sampling supports fractional centres. Registration tests 49 integer translations within +/-3 px,
never scale/rotation. Non-256 masters are normalized once exactly as `runProject`; frames retain production calibration.
Consecutive pairs are clip-local; looping clips also include last->first. Pairs touching a D41 exemption remain labelled
separately. Alpha IoU and RGB histogram affinity are diagnostics only. Reference: https://ece.uwaterloo.ca/~z70wang/publications/ssim.pdf.

| Control          | Intended check        | Current diagnostic                                            |
| ---------------- | --------------------- | ------------------------------------------------------------- |
| Other-class head | A: head palette       | Lab18.9767                                                    |
| Wrong torso      | A: torso palette      | Lab35.3382                                                    |
| Hue change       | A: chroma/palette     | Lab31.8389: hard reject; luminance alone misses it            |
| Mirrored head    | B: temporal or layout | SSIM0.3683: review-by-eye plus mandatory contact-sheet review |
| Head scaled 85%  | C: full QA head band  | 42.82px, below49.17..52.22; correctly fails                   |

The controls use a deterministic master/control/master sequence and frozen construction geometry; they are synthetic
QA fixtures, never production evidence or art edits. Calibrated known-good head/torso maxima are 11.0535/11.5766,
below the approved 15/23 ceilings. Temporal known-good minimum 0.1749 overlaps the mirror, so B is diagnostic with
mandatory eye review. L1 is never a hard failure. See `docs/OPEN-ITEMS.md` for the 11 Lab rebuild blockers and D54
re-evaluation; source validation snapshots predating D55 do not prove a clean rebuild.

The read-only audit reports all frame/pair scores, exemptions, actual annotations, windows, registration, component
distributions, input/code hashes, the control matrix and the original 33 D54 cells. It rejects input/code changes during
evaluation and protects input directories and unrelated report files. Outputs must be outside inputs:

```bash
npm run sprite:audit-similarity-crops -w @vgtd/sprite -- --root assets-src/placeholder --baseline /absolute/path/head-reason-similarity-audit.json --control-matrix /absolute/path/similarity-identity-temporal-controls.json --out /absolute/path/similarity-identity-temporal-audit.json
```

Repeat `--project /absolute/path/project.json` for frozen worker candidates. JSON contains every cell/pair, including
explicit Lab coverage gaps and actual A+C failures. A dedicated `*-palette-findings.html` page contains the merged
Lab hard findings with exact master/cell crops. HTML and supporting PNGs show the old/static-master experiment alongside candidate A/B
distributions. `--sensitivity-report` accepts the historical static-SSIM control report. The audit never exports assets,
rewrites annotations, updates backlogs, or turns an exemption into a pass.
