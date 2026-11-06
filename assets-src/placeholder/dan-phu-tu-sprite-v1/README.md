# Đan/Phù tu A — frame-by-frame sprites

Provisional recommendation: A, the jade and ivory whisk healer. The concept comparison and five-direction turnaround preserve the established Kiếm tu / Thể tu painted style. The owner may replace this recommendation later.

E and SE each contain all 15 public sprite clips (156 source cells per direction); `attack_1.png` supplies runtime clip `attack`. S, NE and N have masters and remain in production.

## Reproduce

Run from the repository root after `npm ci`. Substitute `SE` for `E` to reproduce the second direction:

```sh
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/dan-phu-tu-sprite-v1/prepare-masters.ts assets-src/placeholder/dan-phu-tu-sprite-v1
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/dan-phu-tu-sprite-v1/prepare-direction.ts assets-src/placeholder/dan-phu-tu-sprite-v1 E
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/dan-phu-tu-sprite-v1/assemble.ts assets-src/placeholder/dan-phu-tu-sprite-v1/E <temporary-normalized-directory> apps/client-cocos/assets/resources/dragonbones/danphutu-sprite-v1
npm run capture -w client-cocos -- --src dragonbones/danphutu-sprite-v1 --stem danphutu --direction E --animations all --frames 12 --mode single --zoom 2 --sample midpoint --gif --out <capture-directory>
```

The committed direction projects point to raw AI grids with different image DPI. Run the DPI-normalization stage before the final shared builder: direct `runProject` / `sprite:build` / `sprite:batch` on these raw project files skips the recorded cell-DPI stage and master-locked 208/231 scale. Such a direct run is not a reproduction of the exported assets. For the merged SE set, the complete command is:

```sh
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/dan-phu-tu-sprite-v1/assemble.ts assets-src/placeholder/dan-phu-tu-sprite-v1/SE <temporary-SE-normalized-directory> <temporary-SE-export-directory>
```

This writes the normalized working `project.json` in the first temporary directory. Pass that prepared project to the shared batch CLI. Rechecked against main after #122: SE has zero hard findings, zero unlisted soft findings, 28 accepted findings and zero regressions. The raw-project direct run's 22 hard findings came from skipping these input stages; no source pixels or thresholds were changed. A declared shared DPI stage is being coordinated with the pipeline owner; adopt it when merged.

`assemble.ts` fails if a sheet is missing, its cells cannot be normalized without distorting anatomy, a hard gate fails, or a soft finding is unlisted/regresses. `--available` is diagnostic only. `--accept-soft` explicitly records current soft measurements using the public backlog API; it never accepts hard failures.

Clip metadata starts from public `projectClipDefaults`. Event phases use the shared clip-table defaults without character-specific overrides; the drawn contact and talisman-presentation poses span those trigger moments. Only the rendered sheet layout and explicit anatomical pose exceptions are character-owned. Assembly writes `dpi-calibration.json` beside the direction's project file, so the commands above regenerate the committed DPI record. Normalized images and the prepared project for the shared batch/review CLIs stay in temporary working space.

## Scale and QA

Raw grids first receive DPI normalization to square pipeline cells. The hit sheet's external black letterboxing is cropped with recorded bounds; no character pixels are cropped. One locked character scale, **208 / 231**, then applies across every clip and future direction. Alignment changes translation only. `character-calibration.json` and `E/dpi-calibration.json` record both stages. No frame-specific scaling is used.

Each direction exports one **2048 × 2048 PMA atlas**, 156 regions. Upright heights: E idle 207–210 px, walk 214 px, run 204–207 px; SE idle 209–213 px, walk 205–213 px, run 208–213 px. Seated, lunge, death-collapse and bow exceptions are explicit per-cell entries in the projects; the original anatomy remains at the common scale. The contracts record their measurements. SE uses a 2×2 hit layout to avoid letterboxing; E preserves its existing four-across source.

Both strict pipeline contracts have **zero hard failures**, no unlisted soft finding and no regression: E has **26 accepted soft findings**, SE has **28**. See `quality-backlog.json` / `.md` for exact clip, direction, cell, metric, value, limit and repair note. The JSON's `entries` use the public automated backlog format. Its public `manual` array records observations outside automated gates: weak leg reversal, two E gray talismans, residual violet-spill pixel counts for all cells, and the directional validation limitation below. `manual-art-findings.json` preserves the per-cell numeric evidence and imports through `sprite:backlog --backlog <quality-backlog.json> --import-manual <manual-art-findings.json>`; the shared importer retains those numbers in each observation's note. There are 159 E and 160 SE open visual/validation records. These stay open; never infer they are resolved because a gate does not emit them. Regenerate this manual section with `record-visual-qa.ts` after the final export.

The shared foot-slide gate currently measures sole travel along +x. SE's y-motion component is not validated; its measured slide/ghost figures are diagnostic first-pass values. Both locomotion clips retain explicit clip-level manual records for that unverified axis. Directional gait tooling is coordinated through the orchestrator; this art package does not change the shared gate.

E run cells 3 and 8, and SE run cells 2 and 7, were repaired locally; each splice verified the other nine cells byte-identical. E meditation attempt 2 replaces enlarged seated anatomy. SE meditation attempt 2 replaces a stand/sit transition with sustained seated poses; SE channel attempt 2 fixes the seam and upper-torso visibility. All other clip sheets use their first generation. No clip has exceeded the reroll limit.

Exact prompts, tool output IDs and UTC times are in `provenance.json` and each direction’s `sheets/*.generation.json`. Model: **undisclosed by tool**. All generated art remains an internal AI placeholder; release approval and license review are outstanding. Per-file rows are in `docs/ASSET-LICENSES.md`.

## S source checkpoint

All 15 S sheets contain 156 selected cells at the same locked 208/231 scale. Cell-local height repairs affected idle cell 11 and emote cells 9, 10 and 11; each splice verified every other cell byte-identical. Frozen directional-tooling per-clip checks found zero hard failures, 32 explicitly recorded automated soft findings and 156 open per-cell spill observations. Together with E/SE, the shared backlog contains 86 metric entries and 475 manual observations; none of the manual observations are art-worker resolved.

S final aggregate export, complete DPI calibration record, event validation and all-clip Cocos captures await the merged multi-page/directional tooling. No final S runtime output is claimed at this checkpoint. Original S walk/run generation PNGs and manifests remain byte-preserved in `S/generation-templates/`, with SHA-256 records. The `S/templates/` gait files are newly generated directional QA inputs, identified by their tooling commit. Generation metadata points to the original archived inputs.

`S/clip-overrides.json` is character-owned pose data: upright attack sheets retain their master identity checks without lunge exemptions; emote cells 6/7 are actual bows; walk/run retain source y stride with `vertical: keep`. The thin preparation helper reads this optional data and retains public clip-table event defaults. Final regeneration must use the merged directional API before publishing S.
