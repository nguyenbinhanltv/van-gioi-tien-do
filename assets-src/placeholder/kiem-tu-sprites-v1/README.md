# Kiếm tu concept A — full E sprite source

D41 first-pass player body: 126 runtime drawings in all 15 public SPRITE_CLIPS. This extends PR #120; polish remains explicitly backlogged.

```sh
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/kiem-tu-sprites-v1/E/project.json --out <temporary-directory>
npm run sprite:batch -w @vgtd/sprite -- --batch assets-src/placeholder/kiem-tu-sprites-v1/batch.json --out <temporary-directory>
```

The build passes D41: zero hard failures, 14 recorded soft foot findings, zero regressions. It does not claim zero sliding or final visual acceptance. E/quality-backlog.json contains metric findings. E/manual-art-findings.json separately records visual defects and deliberate manual resolutions until the public pipeline supports their kinds.

Run and walk have 12 drawings each; dash 6; hit 4; tribulation 12; other clips 8. Runtime attack is attack_1. New sheets include unused standing controls, documented in E/control-calibration.json. Their measured raw height establishes one fixed scale per sheet; controls never become displays. Frames get translation only. Named exceptions preserve seated, airborne, lunge and kneeling proportions.

## Source repairs and traceability

reference/E.master4x.source.json records the durable PR #80 source path and SHA256, archived 512 px master and generation-alias hash. The historical premultiplied Lanczos upscale is recorded but not re-verified. Source and tooling pins are main ancestors. Every selected raw output is archived and hash-linked; every current sheet has a SHA256 in provenance.json.

The original five-cell run repair terminates at E/repair-inputs/run.carry-before.png. run.carry-proof.json continues to the current sheet: cells 7–12 use one low near-RIGHT sword carry, while the first six cells remain byte-identical. The arm-mask composite was rejected for clipped counterhands, so the six selected cells are complete AI redraws. Minor cloth drift remains recorded. hit.repair-proof.json includes unchanged-cell and outside-mask pixel hashes. attack_3 and tribulation guide-cleanup proofs verify that all interior pixels survived boundary cleanup unchanged. No final character pixels were painted manually.

## Remaining findings

Actual flat-sole run contacts are annotated in E/run-contacts.json. Four old probes targeted airborne feet; removing them corrects the annotation and does not fix stride. Repeated contacts, weak near/far reversal, robe drift and a hair-flow jump at the loop boundary remain manual findings. The 14 metric entries include wrong ghost positions and walk sliding of 3.1–5.2 px/frame; 999 denotes no sole within the probe window, not a measured 999 px gap. Speeds and tolerances are unchanged. Palette-aware interior magenta cleanup is enabled.

attack combo_window 7 retains the shared default: cancel_window tick 9/13. attack hit_frame 5 maps contact drawing 5 to tick 7/13; cast windup_end 7 maps release drawing 5 to tick 8/15. attack_2 and attack_3 use public phase defaults.

The export uses one 2048² PMA atlas, padding 2, extrude 1 and 126 regions, selectable from dragonbones/kiem-tu-sprites. Full Cocos captures and the owner review page are session artifacts outside git. The single-root viewer bone seam metric is not raster QA.
