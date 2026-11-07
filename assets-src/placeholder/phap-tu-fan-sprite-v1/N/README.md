# Pháp tu B N — Vermilion Fan Adept

D42 B, full straight back view. Fifteen clips / 126 drawings; open cyan/teal fan remains in the anatomical right (viewer-right) hand. Master, turnaround, ivory/vermilion/navy costume and locked character scale follow the merged E lot. The character batch now builds all five directions: 75 clips / 630 drawings.

```sh
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/phap-tu-fan-sprite-v1/N/project.json --out <temporary-directory>
npm run sprite:batch -w @vgtd/sprite -- --batch assets-src/placeholder/phap-tu-fan-sprite-v1/batch.json --out <review-directory> --capture
```

Declared square-cell-dpi-v1 preparation normalizes each whole sheet. Shared 208/237 calibration (0.8776371308016878) stays fixed; no per-frame resizing or gameplay speed/threshold changes. Walk/run use vertical:keep and public direction-correct XY ghosts. Boot spacing is measured from the canonical master; no UNMEASURED opt-out. Idle heights 212..212 px, walk 204..208, run 203..209 against master 208 px ±3%.

Hard QA passes with zero regressions and 28 accepted measured soft findings. Exact clip/cell/metric/value/limit records are in quality-backlog.json; four visual observations remain separate and open: subtle leg reversal, repair redraw drift, weak channel seal gesture and restrained hit recoil. Only meditate0..7 and die4..7 declare folded-pose exceptions (12 cells). The before-exception diagnostic and per-cell declarations are retained; these are visual-review poses, not generic standing-similarity passes.

Seventeen image_gen calls: 15 initial sheets plus one selected-cell anatomy repair for walk and one for run. All generated PNGs, prompts, relative references, SHA256 and model-undisclosed/CLI records are preserved. Two repair proofs verify that unselected decoded RGBA cells stay unchanged. No final character pixels were manually painted; code drew guide/mask pixels and public repairCell selected whole generated cells. Hit uses 2x2 square cells for the same four poses/timing from its initial call.

Usage-limit interruption occurred after the final five sheets were generated, before their in-memory call metadata was saved. Their original PNGs were recovered without regeneration. generation-recovery.json verifies exact prompt reconstruction from committed prompt records and logged transformations. For these five, utcStart is the logged batch invocation time; utcEnd is the original PNG write time. Per-call JavaScript clock values were not recovered and are not claimed. The recovery basis is also recorded on each affected provenance entry.

Runtime export: one 2048² PMA atlas, padding 2 / extrude 1, 126 regions, one DragonBones display-swap armature. Independent rebuild matches all four files; raw written atlas has zero RGB-above-alpha pixels. Source images remain straight alpha. Real Cocos capture covers all 15 clips at 2x with midpoint sampling. Runtime src dragonbones/phap-tu-fan-sprite-v1, stem phaptu, direction N. One-root bone seam=0 is not raster QA.
