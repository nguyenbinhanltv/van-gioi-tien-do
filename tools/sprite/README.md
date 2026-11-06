# @vgtd/sprite

Frame-by-frame AI sprite-sheet pipeline for Player bodies (D41, `docs/art/sprite-sheet-pipeline.md`).

```
npm run sprite:template -w @vgtd/sprite -- --clip run --frames 12 --cols 6 --gait run --master <master.png> --out <dir>
npm run sprite:build    -w @vgtd/sprite -- --project <project.json> --out <dir> [--allow-errors]
npm run sprite:repair   -w @vgtd/sprite -- --sheet <orig.png> --edited <edited.png> --cell <i> --cols <n> --rows <n> --out <fixed.png>
```

Stages (all exported from `src/index.ts`): `buildTemplate` / `locomotionCells`, `sliceSheet`, `paletteFromMaster` /
`lockPalette`, `calibrate` / `alignFrame` (one fixed scale per character or per sheet, translation only, pre/post
metrics recorded), `packFrames` (<= 2048 pages, padding 2, extrude 1, premultiplied), `buildArmature` (one DragonBones
armature, slot `body`, stepped `displayFrame`, events from the animation table), `runQa` (height +-3 %, foot slide,
loop seam, face/torso similarity, all frames present), `repairCell` (one cell replaced, the rest byte-identical),
`runProject` (the whole chain). Engine-free; images use the `@vgtd/rig` raster / PNG codec.

MaxRects tries one page first and emits additional pages only on overflow, without rotating,
downscaling or dropping frames. Each page stays within the atlas budget. The first page retains
`<stem>_<DIR>_tex.json/png`; additional pages use `<stem>_<DIR>_page1_tex.json/png`, etc.
Multi-page contracts add `atlas.textures`, an ordered list of extensionless resource stems
(primary first). Single-page exports omit it and remain byte-stable.

The Cocos actor loads all pages before building the same single armature. It registers extra
pages through public `CCFactory.parseTextureAtlasData` under the primary atlas asset UUID,
deduplicating shared registrations. The skeleton retains all displays, original geometry and
clip-table events; each atlas JSON contains only its own regions. Memory reporting sums every
texture. Copy the complete output folder (including `.sprite.json`); `sprite:batch --capture`
stages all files automatically and resolves its repository from the original launcher entry.
