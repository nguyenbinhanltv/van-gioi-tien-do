# Đan/Phù tu A — premium semi-chibi

Status: corrected construction and tier front studies; all15 E clips generated (202frames), native production QA passed; final real Cocos3.8.8 capture passed. The old semi-realistic set remains separate.

D55 is merged: Đan/Phù E historical run/dash L1 findings are cleared under A+C; those repairs are cancelled. SE now has0 native hard failures after a masked head-only correction with D57 and exact24Hz D58 export. Final SE real Cocos 3.8.8 2× capture passed; publication status is tracked in SE/README.md. Historical similarity/capture records are not current D55 verdicts.

## Construction

The approved T3 supplies the fixed adult face, olive-brown almond eyes, delicate brow, serene lips, folded bun and two side strands. T1 uses ivory/jade with narrow antique-gold trim, sparse ink-wash hem, plain brown whisk with ONE bronze collar and white horsehair. Meditation has no lotus; talismans are separate FX.

Selected front8 manual readings: maincap170, eyes355, chin433, sole1326, H1156. Head22.75%, eye16.00%, conservative shoulder centers405–695 give25.09%H. Earlier390–705 shoulder readings were too assertive. These are visual landmarks with uncertainty, not an automatic anatomy detector.

Selected turnaround takes the actually AI-corrected E cap from attempt5; the other four panels remain from attempt4. Native E maincap72±2 excludes the elevated bun; eyes168, chin216, sole692. The rejected66 estimate is retained, not used. Selection hashes are in reference/turnaround-selection.json.

reference/direction-landmarks.json and place-landmarked-masters.ts use ONE common scale216/(692−72), ground232, inset0, across all5 directions. Anatomical heights216–219.83px are within3%; alpha bounds including bun remain separate. Occluded back crown rows retain explicit manual uncertainty. T2–T5 front masters are AI outfit edits of front8 using one shared front calibration. Variant face/pose diagnostics remain pending; no pixel-perfect claim.

Initial208px silhouette masters and earlier front/turnaround/tier attempts are superseded studies. prepare-masters.ts and prepare-tiers.ts reproduce those studies, not current inputs.

## E motion

init-e.ts uses public smooth-v2 defaults and pose tags:202frames at nominal24fps across15clips. Hit6+dash10 share one valid16-cell sheet with clip-local mappings. Every source sheet has a separate image-generation call and provenance. Head/full-body stamps are INPUT authoring guides only; final motion drawing comes from image generation.

motion-calibration.json fixes logical scale1 across normalized sheets. Whole-sheet DPI preparation records actual source dimensions. No individual output frame is fitted or rescaled. select-source-cells.ts rejects dimension changes and selects complete native AI cells with per-cell hashes. Native-cell selection proofs retain every attempt. Run/dash use measured head-only repairs; die selects corrected frame0. Attack3 selects anticipation0,1 and a rear-boot-only correction in cell7. No body scaling is applied.

E/policy-notes.json records D41 free-pose declarations and D47 upright head-size evidence. Upright idle/walk/run/dash use D47; emote conservatively follows the current public upright default. Free meditation/fall/attacks/hit/hover/tribulation/cast release retain D41 declarations. None waives clipping, anatomy drift or true foot errors.

qa-generated.ts runs native gates plus local projected-canvas guards; missing sheets cannot imply a full pass. All202 E frames pass the native hard gates with zero canvas loss. Run/dash head repairs and D47 evidence, attack3 fixed-root origins and rear-boot repair are resolved. The E full-source compatibility export and real Cocos Creator3.8.8 capture passed: all15 clips at2x,24 midpoint samples each; E/engine-gate.json records source/runtime/capture hashes. The24 soft foot/height findings, manual landmark uncertainty and mobile texture residency remain open in quality-backlog.json. SE merged in PR #180; S is in progress, followed by NE/N.

## S motion checkpoint

All15 S clips /202 source drawings are present. Rejected AI cap-band edits remain historical and are not active sources. The owner-authorized replacement is deterministic HEAD-ROI-only uniform scaling, at most5%, with Lanczos3 feather, locked chin/base, exact outside-mask RGBA and D57 registration. No whole-frame/body fit is introduced.

Run and dash0/9 head checks pass. Dash2/4 still fail the unchanged head band after the maximum allowed original-source correction; they remain hard failures, not D60 bracket cases. D55 checks145 cells without head-reason skips:145 pass Lab,0 fail,57 separate D41 free-pose exemptions. All21 measured soft findings and the manual neutral-dash foot-depth warning remain open. S/README.md and S/head-roi-checkpoint-qa.json record the current state. S final export, real Cocos capture and direction PR remain pending.

## Provenance

reference/provenance.json retains construction prompts, tool, undisclosed model, UTC, inputs, SHA256 and rejected attempts. E/provenance/*.json records each motion call. Selection proofs sit beside selected sheets. Worker26's append-only ASSET-LICENSES section lists every PNG. quality-backlog.json tracks soft findings and manual uncertainty; no hard failure is accepted as a soft finding.

Run from repository root:
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/dan-phu-tu-chibi-v1/qa-generated.ts assets-src/placeholder/dan-phu-tu-chibi-v1/E <temporary-output-directory>

PR #166 delivers the E full-source compatibility export plus reproducible official D45 aligned-guide provenance in E/layer-guide-provenance.json. Derived guide PNGs are not committed in this pass. This is not an extracted layered runtime delivery. Dedicated body/weapon/FX extraction is scheduled by the orchestrator after all5 T1 directions are merged.

Rear NE/N construction chin placeholders are not visible anatomical evidence. Before rear motion, use the merged D50 rear-crown-shoulder policy with actual same-direction crown, visible shoulder-top and skull-breadth landmarks; never project a chin or guess an occluded nape.
