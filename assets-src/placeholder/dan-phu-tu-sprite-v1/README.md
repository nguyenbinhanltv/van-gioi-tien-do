# Đan/Phù tu A — frame-by-frame sprites

Provisional recommendation: A, the jade and ivory whisk healer. The concept comparison and five-direction turnaround preserve the established Kiếm tu / Thể tu painted style. The owner may replace this recommendation later.

E is the first production direction. All 15 public sprite clips are present (156 source cells); `attack_1.png` supplies runtime clip `attack`. The other four directions currently have masters only.

## Reproduce

Run from the repository root after `npm ci`:

```sh
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/dan-phu-tu-sprite-v1/prepare-masters.ts assets-src/placeholder/dan-phu-tu-sprite-v1
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/dan-phu-tu-sprite-v1/prepare-direction.ts assets-src/placeholder/dan-phu-tu-sprite-v1 E
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/dan-phu-tu-sprite-v1/assemble.ts assets-src/placeholder/dan-phu-tu-sprite-v1/E <temporary-normalized-directory> apps/client-cocos/assets/resources/dragonbones/danphutu-sprite-v1
npm run capture -w client-cocos -- --src dragonbones/danphutu-sprite-v1 --stem danphutu --direction E --animations all --frames 12 --mode single --zoom 2 --sample midpoint --gif --out <capture-directory>
```

`assemble.ts` fails if a sheet is missing, its cells cannot be normalized without distorting anatomy, a hard gate fails, or a soft finding is unlisted/regresses. `--available` is diagnostic only. `--accept-soft` explicitly records current soft measurements using the public backlog API; it never accepts hard failures.

## Scale and QA

Raw grids first receive DPI normalization to square pipeline cells. The hit sheet's external black letterboxing is cropped with recorded bounds; no character pixels are cropped. One locked character scale, **208 / 231**, then applies across every clip and future direction. Alignment changes translation only. `character-calibration.json` and `E/dpi-calibration.json` record both stages. No frame-specific scaling is used.

E export: one **2048 × 2048 PMA atlas**, 156 regions. Upright heights: idle 207–210 px, walk 214 px, run 204–207 px. Seated, lunge, death-collapse and bow exceptions are explicit per-cell entries in the project; the original anatomy remains at the common scale. The contract records their measurements.

The strict pipeline contract has **zero hard failures**, **26 accepted soft findings**, no unlisted soft finding and no regression. See `quality-backlog.json` / `.md` for exact clip, direction, cell, metric, value, limit and repair note. The JSON's `entries` use the public automated backlog format. Its `visualFindings` extension retains the same per-cell fields for observations outside automated gates: weak leg reversal, two gray talismans, and residual violet-spill pixel counts for all 156 cells. These stay open; never infer they are resolved because a gate does not emit them. Regenerate this manual section with `record-visual-qa.ts` after the final export.

Run cells 3 and 8 were repaired locally; each splice verified the other nine cells byte-identical. Meditation attempt 2 replaces the enlarged seated anatomy of attempt 1. All other clip sheets use their first generation. No clip has exceeded the reroll limit.

Exact prompts, tool output IDs and UTC times are in `provenance.json` and `E/sheets/*.generation.json`. Model: **undisclosed by tool**. All generated art remains an internal AI placeholder; release approval and license review are outstanding. Per-file rows are in `docs/ASSET-LICENSES.md`.
