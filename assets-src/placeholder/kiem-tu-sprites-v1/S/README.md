# Kiếm tu S — full sprite production

D41 first pass: 15 public clips and 126 runtime drawings. Run and walk have 12 cells each; dash has 6, hit has 4, tribulation has 12, and the other clips have 8. The camera stays frontal for S; anatomical RIGHT is viewer LEFT. Unused standing controls never become displays.

Build with npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/kiem-tu-sprites-v1/S/project.json --out <temporary-directory>. The adjacent batch.json supports sprite:batch.

../reference/S.master4x.source.json records the PR #80 source/result SHA-256 and reproducible premultiplied bilinear 256→512 upscale, pinned to main tooling. provenance.json archives 20 image_gen calls: 15 initial sheets and 5 whole-sheet cleanup edits, with exact prompts, UTC, model undisclosed, CLI 0.166.0 and reference/output hashes. Five combat originals copied grids, shadows or trails; selected cleanup edits replace those whole sheets. Originals remain archived; there is no unchanged-pixel claim. No final character pixels were painted manually.

One fixed scale per sheet comes from a standing control or locomotion median; frames receive translation only. Run heights of 206–211 px and walk heights of 205–209 px pass master 208 ±3%. Original dirty-grid combat bounds are not physical height measurements. Selected clean sheets are calibrated from clean controls.

QA hard gates remain unchanged. After #123, walk and run explicitly report foot slide as UNMEASURED: their approved playback uses per-frame sole alignment, and direction-correct QA guides with vertical: keep have not been validated. All 15 legacy x-only baseline entries and the original generation inputs remain unchanged and unprunable while unmeasured; they are not numeric acceptance of directional metrics and are not marked resolved. No speed or threshold changes. Lotus, flight, raised-sword/lunge, kneeling and collapse exceptions preserve proportions; upright bounding-box similarity skips these declared poses. Pre-exception torso scores of 0.65 for die, 0.67 for attack and 0.68 for a raised-sword pose remain visible in diagnostics/manual notes, not claimed as measured passes.

Attack_3 blade tips are complete after cleanup but have tight 2–4 raw-pixel top margins, recorded in the manual backlog. Cast windup_end 7 anchors release drawing 5 at tick 8/15 as in E. Other attack/combo phases use public defaults.

Export: one 2048² PMA atlas, padding 2, extrude 1 and 126 regions. Independent written-PNG audit found 0 RGB>alpha pixels; the packaged-source rebuild is byte-identical. Real Cocos captured all 15 clips at 1x and 2x. Runtime selection is dragonbones/kiem-tu-sprites, stem kiemtu, direction S. The single-root bone seam metric is not raster QA. E and SE remain separate in PRs #125 and #127.
