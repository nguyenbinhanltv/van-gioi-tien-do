# Kiếm tu NE — full sprite production

D41 first pass: 15 clips, 126 runtime drawings. Run/walk 12 frames; dash 6; hit 4; tribulation 12; other clips 8. Sixteen image_gen calls: 15 initial sheets and one run repair. Every raw output, exact prompt, UTC, undisclosed model, CLI version and SHA256 is recorded in provenance.json. Reference derivation and hashes trace to the committed PR #80 NE turnaround.

```sh
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/kiem-tu-sprites-v1/NE/project.json --out <temporary-directory>
npm run sprite:batch -w @vgtd/sprite -- --batch assets-src/placeholder/kiem-tu-sprites-v1/NE/batch.json --out <temporary-directory>
```

Every sheet has one fixed control/median calibration; no individual frame is resized. Run cell11 was redrawn to extend the boot instead of scaling the body; run.repair1.proof.json verifies SHA256 for all cells (11 unselected cells identical), raw selected output and final sheet. Original referenceHeight304 stays locked. Run heights204–214px; walk203–213px against master208±3%.

Hard QA passes with named anatomical pose exceptions (seated, airborne, lunge, raised sword, collapse). Original pre-exception pose diagnostics remain in unexcepted-pose-diagnostic.json; exceptions do not establish similarity for an upright bbox on a prone body. Two free-pose height warnings remain accepted: hit cell3=195px, tribulation cell11=196px.

Walk/run directional foot slide is explicitly UNMEASURED. The pre-#123 generation guides normalize each cell to its lowest sole. A valid vertical:keep migration needs validated source-ground registration and direction-correct QA guides. Seventeen legacy metric records are retained, including 15 historical foot probes; those are not accepted new directional metrics. No speed/tolerance changes. Five manual art observations are separate from metric acceptance/resolution.

One2048² PMA atlas, padding2/extrude1,126 regions. Runtime is one display-swap armature at dragonbones/kiem-tu-sprites, stem kiemtu, directionNE. Complete export includes .sprite.json. Engine captures cover all15 clips at1x/2x; the single-quad bone seam number is not raster QA. Default selection and other direction exports remain unchanged.
