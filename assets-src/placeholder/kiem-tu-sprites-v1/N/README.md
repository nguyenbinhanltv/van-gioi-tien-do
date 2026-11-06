# Kiếm tu N — full sprite production

D41 first pass: 15 clips,126 runtime drawings. Run/walk12; dash6; hit4; tribulation12; others8. Fifteen image_gen calls, no rerolls or selected-cell repairs. Original raw outputs, generation templates, exact prompts, UTC, undisclosed model, CLI and SHA256 are retained. Reference source record traces the reproducible premultiplied bilinear256→512 master to PR #80.

```sh
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/kiem-tu-sprites-v1/N/project.json --out <temporary-directory>
npm run sprite:batch -w @vgtd/sprite -- --batch assets-src/placeholder/kiem-tu-sprites-v1/N/batch.json --out <temporary-directory>
```

Each sheet has a fixed scale from its unused standing control or original locomotion median. No per-frame scale fitting. Walk207–208px, run206–210px versus master208±3%. Named anatomical exceptions cover seated, airborne, lunging, raised-sword and collapse poses. unexcepted-pose-diagnostic.json retains pre-exception measurements; upright bbox similarity is not established for prone poses. Hit cell3=195px is an accepted free-pose warning.

Directional walk/run foot slide is explicitly UNMEASURED. The pre-#123 generation templates normalized each cell to the lowest sole; a valid measured migration requires source-ground registration and direction-correct vertical:keep guides. No numeric foot-slide acceptance, gameplay speed change or threshold relaxation. Four manual observations are separate from automatic metric acceptance/resolution: subtle reversal, measurement limitation, recoil height and cheek sliver during side fall.

Runtime: one2048² PMA page, padding2/extrude1,126 regions and one DragonBones display-swap armature. Complete export includes .sprite.json. Cocos captures all15 clips at1x/2x. Bone seam=0 on one root quad is not raster QA. Sources stay straight alpha; only runtime atlas is PMA.
