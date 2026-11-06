# Ki?m tu S ï¿½ full sprite production

D41 first pass: all15 public clips,126 runtime drawings. Run/walk12, dash6, hit4, tribulation12, others8. Fixed frontal S camera, anatomicalRIGHT sword hand viewerLEFT. Unused standing controls never become displays.

Build: npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/kiem-tu-sprites-v1/S/project.json --out <temporary-directory>

Batch: npm run sprite:batch -w @vgtd/sprite -- --batch assets-src/placeholder/kiem-tu-sprites-v1/S/batch.json --out <temporary-directory>

../reference/S.master4x.source.json records PR #80 source/result SHA256 and reproducible premultiplied bilinear256?512 upscale pinned to main tooling. provenance.json archives20 image_gen calls:15 initial sheets +5 whole-sheet cleanup edits, exact prompts/UTC/model-undisclosed/CLI0.166.0 and reference/output hashes. Five combat originals copied grids/shadows/trails; clean selected edits replace those whole sheets. Originals remain archived; no unchanged-pixel claim. No manual final-character painting.

One fixed scale per sheet from a standing control or locomotion median; per-frame translation only. Run206ï¿½211px, walk205ï¿½209px pass master208ï¿½3%. Original dirty-grid combat bounds are not physical height measurements; selected clean sheets calibrated from clean controls.

QA:0 hard failures with documented anatomical exceptions,15 accepted directional foot diagnostics,0 regressions. S travel is screen depth (axis x0,y1), while current foot checker assumes horizontal x. Exact numbers retained as diagnostics, not actual S slide claims; no speed/tolerance changes. Lotus/flight/raised-sword/lunge/kneel/collapse exceptions preserve proportions; upright bbox similarity skips these declared poses. Pre-exception .65 die / .67 attack / .68 raised-sword torso scores remain visible in diagnostics/manual notes, not claimed measured passes.

Attack_3 blade tips are complete after cleanup but have tight2ï¿½4 raw-pixel top margins, backlogged. Cast windup_end7 anchors release drawing5 to tick8/15 as E; other attack/combo phases use public defaults.

One2048ï¿½ PMA atlas, pad2/extrude1,126 regions. Independent written-PNG audit0 RGB>alpha; packaged-source rebuild byte-identical. Real Cocos captures all15 at1x/2x. Runtime dragonbones/kiem-tu-sprites, stem kiemtu, direction S. Single-root bone seam metric is not raster QA. E/SE are separate PRs #125/#127.
