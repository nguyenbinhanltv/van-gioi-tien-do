# Thuong tu T1 E — smooth-v2 full-source motion

Approved male option C under D51: navy/ivory/red/gold spear vanguard, straight spear with forked red pennon, adult profile and low black ponytail. T1 uses plain cloth, wraps and steel. Loi remains a proposed element. The first PR records both approved male classes, including Dao tu A with storm grey-blue accent; Dao production belongs to its own source package.

This direction delivers D41 full-source compatibility motion: one display-swap body slot contains the complete drawings. The dedicated body/weapon/FX extraction pass follows the five merged T1 directions. The D45 guides are recorded as reproducible hashes below.

## Sources and identity

The canonical five-view reference is in `../reference/`; `../character-calibration.json` records one common 216/680 anatomical scale, separate weapon-inclusive alpha bounds, manual landmarks and the lean shoulder lock. The S shoulder span is 25.5% H +/-0.9%, locked to 24–28% H. Higher-tier pauldrons may overhang. Master E remains SHA-256 `97efe1514c54e775e78879d41d20ea835a32cceccb59785691cf249f5dd34287`.

`project.json` preserves official smooth-v2 timing: 15 clips / 202 drawings over fourteen 4x4 source grids. Hit6 and dash10 select different cells of the same final repaired group. Source DPI is explicit; the fixed motion calibration is 216/224. Native DPI and placement compose in one Lanczos3 pass. No source frame is independently fitted to a pose height or shrunk to avoid canvas loss.

Master head crops are blitted unchanged into generation stencils. `templates/head-stencils.provenance.json` pins exact input hashes and coverage. The additional cell4 stencil is an input-only canonical head reference; its mask/crop/placement are recorded separately. Exported head pixels come from imagegen, followed by public cell replacement/key/palette/alignment APIs. No output anatomy is painted by code.

`../generation-index.json` links the exact prompts, observed UTC, undisclosed model status and retained reference/output hashes. Only project images were used. Selected raw sheets and all edit ancestors remain retained. `verify-repairs.ts` replays the public repair operations and verifies every unrelated cell; the original six hit cells remain byte-identical.

## Measured acceptance

The full source audit has zero hard failures, zero unlisted soft findings and zero regressions. There are **26 accepted walk/run foot-contact findings** under the D41 baseline workflow. Values, limits and the reason remain in `../quality-backlog.json`; they do not certify correct planting. Weak walk lead-leg read remains a planned manual polish item. No speed constants, contact masks or thresholds were changed to suppress findings.

The 24 reviewed run/dash head measurements span **50.99–54.03 px**, against the locked E master 52.546 px with unchanged +/-3%. Points exclude loose strands, ponytail and weapon. `head-evidence.review.json` records every coordinate, frame hash and the single-pixel dash4 outer-jaw clarification. Alpha-edge readouts assisted manual review; they are not semantic anatomy certification. Matting candidates that count feathered/raised hair are not substituted for the reviewed main-cap anchors.

D54 is evaluated separately with **all head reasons removed**: **24 pass / 0 fail / 0 unmeasured**, and no remaining similarity findings. True D41 free-pose exceptions remain separate. Failing dash torso drawings were repaired from the master before acceptance; no failing cell was reclassified to bypass similarity. The final audit command, tool revision, input hashes and counts are in `similarity-audit.provenance.json`.

Matte uses public key35/135 and palette-protected asymmetric despill `{ maxImbalance: 80, edgeRadius: 2 }` at native DPI. Native before/after checks verify alpha invariance and report red-edge colour changes. Dark/light composites, all-frame contact sheets and worst RGB candidates were reviewed for coloured fringe and Lanczos ringing. Legitimate red sash/pennon interiors and silhouette remain intact. RGB heuristics are diagnostic and do not classify art defects automatically.

Real Cocos Creator 3.8.8 built the web viewer and captured all 15 clips at 2x, with 24 midpoint samples per clip. Captured GIFs contain the expected distinct source-frame counts, totaling 202; static bone seam metrics alone are not used as proof of moving sprite pixels. `validation.json` and `cocos-capture.json` retain the commands, hashes and pixel-motion check. Owner-review GIFs and native capture sheets are attached as AO artifacts.

## Reproduction

Run from the repository root:

```powershell
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/thuong-tu-chibi-v1/prepare-masters.ts
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/thuong-tu-chibi-v1/prepare-motion.ts
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/thuong-tu-chibi-v1/verify-repairs.ts E
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/thuong-tu-chibi-v1/verify-matte.ts E --out "$env:TEMP/thuong-E-matte.json"
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/thuong-tu-chibi-v1/audit-source.ts --direction E --out "$env:TEMP/thuong-E-source-review"
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/thuong-tu-chibi-v1/E/project.json --out apps/client-cocos/assets/resources/dragonbones/thuong-tu-chibi-v1
npm run capture -w client-cocos -- --out "$env:TEMP/thuong-E-cocos" --animations all --frames 24 --mode single --direction E --src dragonbones/thuong-tu-chibi-v1 --stem thuongtuchibi --zoom 2 --sample midpoint --gif
```

Preparation regenerates masters/stencils, not AI drawings or reviewed project annotations. It preserves the fixed motion calibration. The audit writes only to its explicit external review directory.

Exact D45 guide command executed for this delivery:

```powershell
npm run sprite:layer-template -w @vgtd/sprite -- --project assets-src/placeholder/thuong-tu-chibi-v1/E/project.json --out C:/Users/PC/AppData/Local/Temp/vgtd32-Thuong-E-D45-24hz
```

Use an empty output directory. `layer-guides.provenance.json` pins the input project/master, `layer-inputs.json` hash and all **14 guide PNG hashes** with clip/cell mappings. The PNGs remain outside the PR until the extraction pass.

Known formatting baseline: `docs/ASSET-LICENSES.md` already fails root Prettier on main. Only this class's appended section is formatted; existing sections are preserved.

## D58 timing correction

The project explicitly selects `timingProfile: "smooth-v2"`. The runtime armature runs at **24 Hz**, with exactly one tick for each of 202 authored drawings. The initial E delivery omitted the opt-in and retained the legacy 30 Hz clock. This follow-up preserves all source PNGs, atlas PNGs, texture JSON, display order and QA findings byte-identically; only skeleton timing changes. `timing-24hz.provenance.json` records the verification and new real Cocos 2x captures. Original capture evidence remains historical; the owner page uses the separate corrected capture directory.
