# Pháp tu B NE — Vermilion Fan Adept

D42 B production direction NE: 15 clips, 126 drawings. Anatomical RIGHT/near hand always carries the open cyan/teal fan. Back three-quarter view faces away/up-right. Vermilion/ivory/navy costume follows the merged five-direction B turnaround; VFX remain separate.

```sh
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/phap-tu-fan-sprite-v1/NE/project.json --out <temporary-directory>
npm run sprite:batch -w @vgtd/sprite -- --batch assets-src/placeholder/phap-tu-fan-sprite-v1/batch.json --out <review-directory> --capture
```

Raw sheets use declared square-cell-dpi-v1 preparation and the shared locked 208/237 calibration (0.8776371308016878). No per-frame scaling or gameplay speed/threshold changes. Idle heights 203..204 px, walk 201..204, run 204..209 versus master 207 px ±3%. Walk/run use vertical:keep and measured direction-correct public ghosts, with boot spacing measured from the canonical master. No UNMEASURED opt-out.

QA: zero hard failures/regressions, 50 accepted measured soft findings; exact clip/cell/metric/value/limit in quality-backlog.json. Four manual observations are separate, one explicitly art-resolved. Generic standing similarity is skipped only for meditate0..7 and die4..7 (12 declared cells, same convention as the merged E lot). qa-before-pose-exceptions.json and pose-exceptions.review.json retain the diagnostic and declarations; folded poses are visually reviewed, not claimed as standing similarity passes.

24 image_gen calls: 15 initial sheets; walk one reroll plus one selected-cell repair; run one reroll plus two selected-cell repairs; attack_3 two cell6 repairs; hit one 2x2 reroll; meditate one anatomy redraw. Every raw output, exact prompt, UTC, model undisclosed, CLI version and reference/result SHA256 is retained in provenance.json. The rejected hit4x1 output is a 3:1 non-square grid and remains archived; selected hit2x2 keeps four poses and the same timing.

Generation-only raw-scale anatomy guides are explicitly separate from original QA templates; they do not change QA ghosts or claim an inverse registration transform. Five SHA256 proof files trace cell-local repairs and unchanged cells. No final character pixels were painted by code or by hand; code drew guide/mask pixels only and public repairCell selected whole generated cells. Meditation reroll corrects the initial enlarged head/torso by preserving idle physical size in a folded pose. Attack_3 cell6 now starts recovery with fan nearer chest; cell5 remains the hit, phase timing unchanged.

Export: one 2048² PMA atlas, padding2/extrude1, 126 regions, one DragonBones display-swap armature. Independent rebuild matches all four files; written PNG has zero RGB-above-alpha pixels. Runtime src dragonbones/phap-tu-fan-sprite-v1, stem phaptu, direction NE. Real Cocos capture covers all15 clips at2x with midpoint sampling. One-root bone seam=0 is not raster QA.
