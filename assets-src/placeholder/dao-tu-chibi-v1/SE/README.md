# Dao tu T1 SE - smooth-v2 full-source motion

Storm Reaver A, elevated front three-quarter facing down-right: lean adult male, grey eyes, swept black fringe and low loose ponytail, dark muted teal with storm grey-blue, heavy broad mountain-ink dao. D51 remains owned by worker32. This is D41 full-source compatibility motion; extracted body/weapon/FX runtime sets follow after all five T1 directions merge.

## Sources and calibration

The locked `../reference/SE.master.png` shares one anatomical scale with all five masters. S is exactly 216 px; SE is 216.94 px. Weapon and loose hair never set body scale. `../motion-calibration.json` fixes scale 1 after whole-sheet square-cell DPI normalization. Individual frames are never fitted or rescaled.

`../prepare-SE-motion.ts` uses public sprite templates and an exact unscaled master head crop, recorded in `templates/head-stencils.provenance.json`. The measured soles are near (104,232), far (154,222). Locomotion ghosts use their midpoint plane y227 and projected stance width; registration remains x128/ground232. Run uses the public locomotion option stance 0.33 so projected ghosts stay inside the canvas. No shared speed, direction or iso constant is redefined. `sole-landmarks.json` records these art measurements. Meditate translates the same unscaled head guide down 72 px to guide a seated pose.

`project.json` records per-frame authored lattice roots and manually reviewed main-skull crown/chin/breadth evidence. Loose curls and ponytails are excluded. Pose exceptions describe observed leaning, bowing, kneeling and turning; head stencils are input guides and do not replace output measurements. `native-source-bounds.json` inspects all 202 selected cells before the slicer inset and records zero unsafe margins.

Every sheet has exact prompt/reference/tool/UTC provenance. Raw originals and unselected attempts remain retained. The run head correction is an AI-authored source edit, not a pipeline scale. The arc-sweep clearance repair selects only cells 3/4 through the public `repairCell` API with equal-canvas assertion; `repair-proof.json` verifies the other 14 cells remain identical. No hard gate is waived.

## Reproduction

Run from repository root:

```powershell
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/dao-tu-chibi-v1/prepare-SE-motion.ts
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/dao-tu-chibi-v1/prepare-SE-repair.mjs
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/dao-tu-chibi-v1/audit-native.mjs SE
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/dao-tu-chibi-v1/SE/project.json --out apps/client-cocos/assets/resources/dragonbones/dao-tu-chibi-v1
```

Guide preparation writes clip defaults, not the reviewed project annotations or AI drawings. `audit-ready.mjs SE <system-temp-directory>` produces official source QA and temporary coordinate/head diagnostics. Its optional acceptance flag is used only after reviewing current soft findings.

The official D45 guides are reproducible removal-edit inputs only. Derived PNGs are deliberately excluded from this direction delivery. `layer-guides.provenance.json` records the exact command, project/master hashes, `layer-inputs.json` hash and all 14 guide hashes with cell mappings:

```powershell
npm run sprite:layer-template -w @vgtd/sprite -- --project assets-src/placeholder/dao-tu-chibi-v1/SE/project.json --out "$env:TEMP/dao-SE-layer-guides-final"
```

## Validation and remaining art work

15 clips / 202 frames, 24 fps authoring: zero hard failures, zero unlisted soft findings, zero regressions. The backlog retains 22 measured SE walk/run contact findings and seven manual findings: hair spill, weak walk reversal and blade/grip redraw drift in heavy cut, sweep, ground strike, death and spinning channel. These are visible follow-up work, not evidence that extraction is complete. Phong remains proposed rather than gameplay-locked.

`validation.json` records the real Cocos Creator 3.8.8 build/capture command, output hashes and repository checks. Capture uses all 15 clips, 24 midpoint samples and device scale 2x. Full-resolution contact PNGs are the capture evidence; the official GIF overviews are downsampled. Source loop QA remains authoritative because bone-only engine seam diagnostics do not establish display-swap continuity.

All inputs are original project assets; OpenAI Output terms were checked on 2026-11-08. Full provenance and the class hash index retain lineage. Licence rows are in worker33's separate append-only SE table. Known baseline exception: `docs/ASSET-LICENSES.md` already fails global Prettier on main; only this worker's appended section is formatted, with prior sections untouched.
