# Ki?m tu SE � full sprite production

D41 first pass: 15 public clips, 126 runtime drawings. Run/walk have 12 cells, dash 6, hit 4, tribulation 12, others 8. Source includes unused standing controls; control-calibration.json records the one fixed scale per sheet. No individual frame is stretched.

```sh
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/kiem-tu-sprites-v1/SE/project.json --out <temporary-directory>
npm run sprite:batch -w @vgtd/sprite -- --batch assets-src/placeholder/kiem-tu-sprites-v1/SE/batch.json --out <temporary-directory>
```

The generation master is a reproducible 256?512 premultiplied bilinear resize of the committed PR #80 SE turnaround. ../reference/SE.master4x.source.json records durable main source/tooling pins, source/result SHA256 and exact transform. provenance.json records all 17 image_gen calls (15 initial sheets plus two run repairs), undisclosed model, UTC, CLI version, archived references and SHA256. Every selected raw output is retained.

Run initially failed five height cells. Whole-cell repair1 fixed cell2; repair2 fixed cells5/10/11/12 (1based). repairCell preserves every other decoded RGBA cell; two SHA256 proof files link original?intermediate?final. The initial run referenceHeight312 is locked throughout. Final run heights203�214 px pass master208�3%; other upright clips also pass. No final character pixels were manually painted. Deterministic template/mask guide construction is recorded separately from character art.

Named anatomical pose exceptions follow the existing E convention: seated meditation, sword flight, raised sword/lunge, kneeling/brace, and collapse retain physical proportions. The upright face/torso bbox comparison skips these declared exceptions; this is not a claim of a measured similarity pass on side-prone bodies. unexcepted-pose-diagnostic.json preserves die cells6/7 torso scores0.68/0.65 against0.70, and the manual companion records that limitation. Standing controls and visual review check costume/scale for these poses.

QA: zero hard failures with those documented exceptions; 11 explicitly accepted metric foot findings (10 ghost mismatches and one run slide3.92px/frame). One999 is a no-sole sentinel, not a measured999px gap. Speeds and tolerances unchanged. SE has depth-separated boots and diagonal travel; current QA is x/lowest-ground oriented, so these probes need visual contact review before drawing speed conclusions. Weak leg reversal and repaired robe drift remain manual companion findings, never fake footSlide entries.

Attack uses default public hit/combo timing; attack_2 contact is drawing4 and attack_3 drawing5. Cast windup_end7 anchors release drawing5 at tick8/15, matching E. Sword stays in anatomicalRIGHT/viewerLEFT hand; no copied E hand orientation.

Export: one2048� PMA page, padding2/extrude1,126 regions. Independent written-PNG check found0 RGB>alpha pixels; packaged-source rebuild is byte-identical. Real Cocos captured all15 clips at2x. The single-root bone seam metric is not raster QA. Runtime path dragonbones/kiem-tu-sprites, stem kiemtu, direction SE; E export is provided by separate PR #125.
