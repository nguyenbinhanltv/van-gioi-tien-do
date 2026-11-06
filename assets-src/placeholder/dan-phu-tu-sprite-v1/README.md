# Đan/Phù tu A — frame-by-frame sprites

Provisional recommendation: A, the jade and ivory whisk healer. The concept comparison and five-direction turnaround preserve the established Kiếm tu / Thể tu painted style. The owner may replace this recommendation later.

E and SE each contain all 15 public sprite clips (156 source cells per direction); `attack_1.png` supplies runtime clip `attack`. S, NE and N have masters and remain in production.

## Reproduce

Each committed direction project declares `preparation: { kind: "square-cell-dpi-v1", calibration: "../character-calibration.json" }`. The shared pipeline normalizes the complete raw sheet grids, applies the one master-locked scale and records raw hashes, crop bounds and DPI metadata in the contract. No temporary project is required:

```sh
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/dan-phu-tu-sprite-v1/S/project.json --out <temporary-S-export>
npm run sprite:batch -w @vgtd/sprite -- --batch assets-src/placeholder/dan-phu-tu-sprite-v1/batch.json --out <temporary-batch-output>
npm run sprite:review -w @vgtd/sprite -- --reports <temporary-batch-output>/batch-report.json --out <review-output>
```

Use the same build command with E or SE for those directions. The batch lists all completed directions. Copy the complete output folder, including its contract and every atlas page, into the character's runtime folder before Cocos capture. The documented S runtime PNG/texture/skeleton bytes match both the shared declared preparation and the earlier explicit assembly path.

The thin `prepare-direction.ts <character-root> <direction>` helper regenerates templates through the public clip table, passes the facing direction, and reads optional character-owned `clip-overrides.json`. `prepare-masters.ts` derives the fixed masters from the turnaround. `assemble.ts` remains a compatibility/audit command for normalized working sheets and per-direction `dpi-calibration.json`; it strips the declaration before invoking the normalized final stage to avoid double preparation. Already-normalized temporary projects omit `preparation`.

The former direct raw-project run skipped cell-DPI normalization and locked calibration, causing the reported 22 SE hard findings. The declaration now reproduces the full stage through the shared CLI without art or threshold changes. SE's legacy walk/run foot measurement remains explicitly UNMEASURED until separate direction-correct guide migration; the earlier baselines remain preserved.

Timing, loops and gameplay phases come from `SPRITE_CLIPS` / `projectClipDefaults` with no character-specific event overrides. S's 15 serialized timelines were checked against the shared defaults. Each source PNG has a row in `docs/ASSET-LICENSES.md`.

## Scale and QA

Raw grids first receive DPI normalization to square pipeline cells. The hit sheet's external black letterboxing is cropped with recorded bounds; no character pixels are cropped. One locked character scale, **208 / 231**, then applies across every clip and future direction. Alignment changes translation only. `character-calibration.json` and `E/dpi-calibration.json` record both stages. No frame-specific scaling is used.

The completed E/SE/S directions each export one **2048 × 2048 PMA atlas**, 156 regions. Upright heights: E idle 207–210 px, walk 214 px, run 204–207 px; SE idle 209–213 px, walk 205–213 px, run 208–213 px. Seated, lunge, death-collapse and bow exceptions are explicit per-cell entries in the projects; the original anatomy remains at the common scale. The contracts record their measurements. SE uses a 2×2 hit layout to avoid letterboxing; E preserves its existing four-across source.

The completed E/SE/S contracts have **zero hard failures**, no unlisted soft finding and no regression: E has **26 accepted findings**, S has **32**. SE has **15 accepted free-pose findings** and **13 preserved legacy foot baselines**; its walk/run foot motion is explicitly UNMEASURED. See `quality-backlog.json` / `.md` for exact clip, direction, cell, metric, value, limit and repair note. The JSON's `entries` use the public automated backlog format. Its public `manual` array records observations outside automated gates: weak leg reversal, two E gray talismans, residual violet-spill pixel counts for all cells, and the directional validation limitation below. `manual-art-findings.json` preserves the per-cell numeric evidence and imports through `sprite:backlog --backlog <quality-backlog.json> --import-manual <manual-art-findings.json>`; the shared importer retains those numbers in each observation's note. There are 159 E and 160 SE open visual/validation records. These stay open; never infer they are resolved because a gate does not emit them. Regenerate this manual section with `record-visual-qa.ts` after the final export.

The merged shared foot-slide gate projects ground travel into the facing direction. S uses newly regenerated directional QA guides, source y stride (`vertical: keep`) and the new non-E metric IDs. SE retains the original generation inputs and explicit legacy UNMEASURED reasons until a separate guide migration; its old x-only baselines are preserved rather than falsely marked fixed. The two manual SE validation observations remain open.

E run cells 3 and 8, and SE run cells 2 and 7, were repaired locally; each splice verified the other nine cells byte-identical. E meditation attempt 2 replaces enlarged seated anatomy. SE meditation attempt 2 replaces a stand/sit transition with sustained seated poses; SE channel attempt 2 fixes the seam and upper-torso visibility. All other clip sheets use their first generation. No clip has exceeded the reroll limit.

Exact prompts, tool output IDs and UTC times are in `provenance.json` and each direction’s `sheets/*.generation.json`. Model: **undisclosed by tool**. All generated art remains an internal AI placeholder; release approval and license review are outstanding. Per-file rows are in `docs/ASSET-LICENSES.md`.

## S direction

All 15 S sheets contain 156 selected cells at the same locked 208/231 scale. Cell-local height repairs affected idle cell 11 and emote cells 9, 10 and 11; each splice verified every other cell byte-identical. The complete merged-main build has zero hard failures, zero unlisted soft findings and zero regressions, with 32 explicitly recorded accepted findings and 156 open per-cell spill observations. Together with E/SE, the shared backlog contains 86 metric entries and 475 manual observations; none of the manual observations are art-worker resolved.

S exports all 156 regions in one 2048² PMA atlas with one armature and the unchanged locked scale. `S/dpi-calibration.json` records all 15 grids. Every serialized gameplay event matches the shared table, and all 15 clips loaded in real Cocos3.8.8 zoom2/midpoint GIF/contact captures. Main #122 supports multi-page output when needed; S currently fits one page after the source-y-preserving alignment. Original S walk/run generation PNGs and manifests remain byte-preserved in `S/generation-templates/`, with SHA-256 records. The `S/templates/` gait files are newly generated directional QA inputs, identified by their tooling commit. Generation metadata points to the original archived inputs.

`S/clip-overrides.json` is character-owned pose data: upright attack sheets retain their master identity checks without lunge exemptions; emote cells 6/7 are actual bows; walk/run retain source y stride with `vertical: keep`. The thin preparation helper reads this optional data and retains public clip-table event defaults. The helper passes the direction to the merged API. S currently uses the documented first-pass default stanceWidth=0; per-cell foot-slide/ghost findings remain in the backlog for later art improvement.
