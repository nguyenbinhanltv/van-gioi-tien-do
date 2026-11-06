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

Quality backlogs keep measured acceptances in `entries` and optional visual observations in `manual`:

```json
{
  "kind": "carry_change",
  "clip": "run",
  "dir": "E",
  "cells": [6, 7],
  "severity": "warn",
  "reviewer": "art-worker",
  "note": "Sword carry changes during the second half of the cycle."
}
```

Manual kinds: `carry_change`, `weak_reversal`, `redraw_drift`, `hair_spill`, `other`.
Cells are zero-based; `[]` covers the whole clip. Severity is a nonempty art-review label (the existing
companion uses `warn` for visible defects and `info` for unconfirmed diagnostics). These observations
are displayed and counted separately in `sprite:backlog` and batch-based `sprite:review`; they do not
accept automatic failures, affect the metric build gate, or enter the automatic resolved list.
`--accept` and `--prune` preserve them. Remove or revise them only after art review.

Migrate worker 17's `vgtd-manual-art-findings` v1 companion without rebuilding art:

```sh
npm run sprite:backlog -w @vgtd/sprite -- --backlog <quality-backlog.json> --import-manual <manual-art-findings.json>
```

The character must match. The import keeps existing metric entries, maps `leg_reversal` to
`weak_reversal` and `key_spill` to `hair_spill`, and maps other unknown kinds to `other`.
It accepts `cell` with `cellConvention: "0based;-1wholeclip"`, or an explicit `cell0based`;
`-1` becomes `cells: []`. Legacy kind, metric, value, limit and status are retained in note text,
never synthesized as QA findings. Exact reimports do not duplicate observations. The JSON and its
Markdown view are written; source companion files are unchanged. Re-run `sprite:batch` before
`sprite:review` to refresh manual observations in existing batch reports.
