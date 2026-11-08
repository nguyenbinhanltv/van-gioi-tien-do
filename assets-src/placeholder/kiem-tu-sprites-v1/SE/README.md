# Kiếm tu SE — full sprite production

D41 first pass: 15 public clips and 126 runtime drawings. Run and walk have 12 cells each; dash has 6, hit has 4, tribulation has 12, and the other clips have 8. Unused standing controls establish one fixed scale per sheet in control-calibration.json and never become displays. Individual frames are not stretched.

Build with npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/kiem-tu-sprites-v1/SE/project.json --out <temporary-directory>. The adjacent batch.json supports sprite:batch.

The generation master is a reproducible 256→512 premultiplied bilinear resize of the committed PR #80 SE turnaround. ../reference/SE.master4x.source.json records durable main source and tooling pins, source/result SHA-256 and the exact transform. provenance.json records all 17 image_gen calls: 15 initial sheets plus two run repairs, with the model undisclosed, UTC, CLI version, archived references and hashes. Every selected raw output is retained.

Run initially failed five height cells. The first whole-cell repair fixed cell 2; the second fixed cells 5, 10, 11 and 12 (1-based). repairCell preserves all unselected decoded RGBA cells. Two SHA-256 proof files link original→intermediate→final. The initial run referenceHeight of 312 stays fixed throughout. Final run heights of 203–214 px pass master 208 ±3%; other upright clips also pass. No final character pixels were painted manually. Template and mask guide construction is recorded separately from character art.

Named anatomical pose exceptions follow the existing E convention: seated meditation, sword flight, raised sword/lunge, kneeling/brace and collapse retain physical proportions. The upright face/torso bounding-box comparison skips these declared poses; this does not claim a measured similarity pass for side-prone bodies. unexcepted-pose-diagnostic.json preserves die cells 6 and 7 at torso scores 0.68 and 0.65 against 0.70, and the manual companion records that limitation. Standing controls and visual review check costume and scale for these poses.

QA reports zero hard failures with those documented exceptions, 11 explicitly accepted metric findings and zero regressions. The findings comprise 10 ghost mismatches and one run slide of 3.92 px/frame. The value 999 is a no-sole sentinel, not a measured 999 px gap. Speeds and tolerances are unchanged. SE has depth-separated boots and diagonal travel; the current x/lowest-ground probes need visual contact review before any speed decision. Weak leg reversal and repaired robe drift remain manual findings, never fabricated footSlide entries.

Attack uses public default hit/combo timing; attack_2 contact is drawing 4 and attack_3 contact is drawing 5. Cast windup_end 7 anchors release drawing 5 at tick 8/15, matching E. The sword stays in anatomical RIGHT / viewer LEFT hand.

Export: one 2048² PMA page, padding 2, extrude 1 and 126 regions. Independent written-PNG audit found 0 RGB>alpha pixels; the packaged-source rebuild is byte-identical. Real Cocos captured all 15 clips at 1x and 2x. The single-root bone seam metric is not raster QA. Runtime selection is dragonbones/kiem-tu-sprites, stem kiemtu, direction SE; E is provided separately in PR #125.
