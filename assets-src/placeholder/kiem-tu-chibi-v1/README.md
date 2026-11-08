# Kiếm tu premium semi-chibi T1

E contains 15 clips / 202 drawings and has passed the official sprite build and real Cocos Creator 3.8.8 capture. The five masters are visually locked; SE, S, NE and N motion remain future direction work. This delivers full-source D41 compatibility frames. Body/weapon/FX extraction is a separate D45 pass after all five directions are merged.

The fixed T1 identity is a plain ivory split robe, navy collar/sash/trousers, small dark boots, black ponytail, cyan ribbon, grey eyes and a simple steel sword in the anatomical right hand. No T3 armor, crown, gems or aura is added.

## Master lock and proportions

The orchestrator approved the five-view visual lock on 2026-11-08. Appearance approval does not replace motion or engine QA.

| View | Raw reference                 | Prepared master           | Anatomical H at 2x |
| ---- | ----------------------------- | ------------------------- | ------------------ |
| S    | `reference/S.master.raw.png`  | `reference/S.master.png`  | 216.00             |
| E    | `reference/E.master.raw.png`  | `reference/E.master.png`  | 214.97             |
| SE   | `reference/SE.master.raw.png` | `reference/SE.master.png` | 214.97             |
| NE   | `reference/NE.master.raw.png` | `reference/NE.master.png` | 214.76             |
| N    | `reference/N.master.raw.png`  | `reference/N.master.png`  | 213.53             |

One S-derived scale is applied uniformly to all views after declared DPI normalization. Anatomical H excludes elevated ponytail and ornaments. The S construction measures head/main-hair 23.66% H, eye line 15.51% H and frontal shoulders 27.67% H. Whole-alpha bounds, approximately 226–228 px, are separate from anatomical H. No individual pose is fitted to a bounding box.

[Original prompts and landmarks](reference/master-source.json), [calibration](reference/master-calibration.json), [visual lock](reference/master-lock.json) and [turnaround](reference/turnaround.preview.png) retain the source history. The first S attempt remains unselected.

## E source and repairs

D46 defaults provide idle/walk/run/cast/meditate/tribulation 16, dash 10, each attack 14, channel/die/emote/sword_fly 12 and hit 6. Runtime first attack is `attack`. D58 `timingProfile: smooth-v2` exports at exact 24 Hz, one tick per drawing. Hit and dash share one 4x4 canonical sheet; there are 14 source groups.

Raw outputs remain unchanged, including rejected attempts. [The raw provenance index](E/raw-provenance-index.json) matches all 32 E raw files to generation records. Each receipt retains the exact prompt, tool, undisclosed model, UTC records and output hash. Requested sheet DPI and actual returned image dimensions are distinguished; source images are normalized explicitly rather than treated as 2048-pixel outputs automatically.

The selected run is `run.repaired-45679.png`; dash/hit use `hit-dash.repaired-023.png`; walk uses `walk.repaired-034.png`. Selection JSON files pin source/master hashes. Original and intermediate sources remain for audit.

- Run head regions and stance-leg repairs retain dynamic flight and lean. Only the measured frame14 head required the last repair.
- Dash2 and dash8 had genuine head-size drift. Local AI head edits target the band centre while preserving the remaining source regions.
- Walk contacts were repaired in declared lower-leg masks. Original face, torso and sword pixels outside each mask remain byte-identical after PNG encoding. Foot findings reduced 8 → 2 → 0.
- Attack/attack_3 padding selects only AI-edited cells7/8; all other source cells remain unchanged.

[Mechanical recipes](E/repair-recipes.json) use committed canonical preimages, raw edits, explicit masks/regions and expected hashes. Their verifier rebuilds eight selected derivatives and checks encoded outside-region RGBA equality. These preimages are repair-proof inputs, not official D45 removal-edit guides.

## Native head evidence

The unchanged E master uses crown (120.5,16.5) and chin (138.5,67.5), Euclidean span54.083269px. Crown X is the midpoint of the topmost contiguous run of at least two main-cap alpha128 pixels, with ribbon/knot/ponytail excluded. Crown Y uses row+0.5 consistently on the master and every measured motion cell. The earlier X124.5 and edge conventions remain in [reference history](reference/head-boundary-review.json).

Seven run and nine dash cells carry actual aligned256 crown/chin evidence, not stencil intentions. Manual uncertainty is approximately1px; borderline cells are accepted only when the frozen rule places them inside ±3%, as adjudicated by the orchestrator. Run14 measures +1.003512%; final dash2 +0.596511% and dash8 +2.686145%. Ordinary in-band cells remain checked. No rear-view landmarks are projected from a hidden chin.

## Validation and remaining polish

Official full E build: **0 hard failures, 0 unlisted soft findings, 1 accepted soft warning, 0 regressions**. The accepted item is upright recovery `attack_2#12`: whole-alpha height220px versus the220.19px band edge, rounded excess0.2px. It remains checked and backlogged; no threshold or body scale is changed.

D55 Lab identity has no hard failures. Legacy L1 is diagnostic. The source/engine contact sheets and temporal flags have been reviewed by eye; minor AI contour variation and some run-wrap lean asymmetry remain explicit art-polish limitations. Palette and head-size passes do not prove pixel-perfect facial consistency or ideal motion smoothness. See [identity review](E/d55-identity-review.json), [quality backlog](quality-backlog.json), [export validation](E/export-validation.json) and [Cocos capture record](E/cocos-capture.json).

The export has two2048x2048 atlas pages, 32MiB decoded RGBA total. These placeholder PNGs are lazily selected through the new viewer source folder; the default player source is not switched. KTX2/ASTC production compression is not verified by this delivery.

Real Cocos3.8.8 capture completed all15 clips at2x with24 midpoint samples, producing15 GIFs and15 contact sheets. The root-bone seam metric is zero for display-swap rigs and is not proof of pixel continuity. GIF centisecond timing is approximate; actual SKE timing is verified at24Hz.

## Reproduce

From the repository root:

```sh
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/kiem-tu-chibi-v1/reproduce-region-edits.ts assets-src/placeholder/kiem-tu-chibi-v1/E D:/Temp/kiem-E-rebuilt-edits
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/kiem-tu-chibi-v1/prepare-authored-origins.ts assets-src/placeholder/kiem-tu-chibi-v1/E --final
npx prettier --write assets-src/placeholder/kiem-tu-chibi-v1/E/project.json
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/kiem-tu-chibi-v1/E/project.json --out D:/Temp/kiem-E-export
node apps/client-cocos/scripts/capture.mjs --src dragonbones/kiem-tu-chibi-v1 --stem kiemtuchibi --direction E --mode single --frames 24 --sample midpoint --zoom 2 --gif --out D:/Temp/kiem-E-capture
```

The capture command builds Cocos from the committed runtime folder. Use a fresh temporary output directory for each attempt.

Official D45 guides are reproduced with:

```sh
npm run sprite:layer-template -w @vgtd/sprite -- --project assets-src/placeholder/kiem-tu-chibi-v1/E/project.json --out D:/Temp/kiem-E-layer-guides
```

Only the exact command, inputs and hashes are retained in [D45 guide hashes](E/d45-guide-hashes.json): `layer-inputs.json` plus14 guide PNG hashes. Those derived guide PNGs are not committed. Dedicated weapon removal/matte/contact/order evidence is scheduled later.

License/source row: KTC1 in [ASSET-LICENSES](../../../docs/ASSET-LICENSES.md). Art direction and pipeline: [D44 style](../../../docs/art/style-semichibi.md), [sprite pipeline](../../../docs/art/sprite-sheet-pipeline.md).
