# Đan/Phù tu A — frame-by-frame sprites

Provisional recommendation: A, the jade and ivory whisk healer. The concept comparison and five-direction turnaround preserve the established Kiếm tu / Thể tu painted style. The owner may replace this recommendation later.

All five directions contain all 15 public sprite clips (156 source cells per direction); `attack_1.png` supplies runtime clip `attack`.

## Reproduce

Each committed direction project declares `preparation: { kind: "square-cell-dpi-v1", calibration: "../character-calibration.json" }`. The shared pipeline normalizes the complete raw sheet grids, applies the one master-locked scale and records raw hashes, crop bounds and DPI metadata in the contract. No temporary project is required:

```sh
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/dan-phu-tu-sprite-v1/S/project.json --out <temporary-S-export>
npm run sprite:batch -w @vgtd/sprite -- --batch assets-src/placeholder/dan-phu-tu-sprite-v1/batch.json --out <temporary-batch-output>
npm run sprite:review -w @vgtd/sprite -- --reports <temporary-batch-output>/batch-report.json --out <review-output>
```

Use the same build command with E or SE for those directions. The batch lists all completed directions. Copy the complete output folder, including its contract and every atlas page, into the character's runtime folder before Cocos capture. The documented S runtime PNG/texture/skeleton bytes match both the shared declared preparation and the earlier explicit assembly path.

The thin `prepare-direction.ts <character-root> <direction>` helper regenerates templates through the public clip table, passes the facing direction, and reads optional character-owned `clip-overrides.json`. `prepare-masters.ts` derives the fixed masters from the turnaround. `assemble.ts` remains a compatibility/audit command for normalized working sheets and per-direction `dpi-calibration.json`; it strips the declaration before invoking the normalized final stage to avoid double preparation. Already-normalized temporary projects omit `preparation`.

The former direct raw-project run skipped cell-DPI normalization and locked calibration, causing the reported 22 SE hard findings. The declaration now reproduces the full stage through the shared CLI without art or threshold changes. SE now uses direction-correct walk/run QA guides and source-y-preserving alignment. Original generation guides and retired x-only baselines remain archived in SE/generation-templates and SE/qa-migration.json.

Timing, loops and gameplay phases come from `SPRITE_CLIPS` / `projectClipDefaults` with no character-specific event overrides. S's 15 serialized timelines were checked against the shared defaults. Each source PNG has a row in `docs/ASSET-LICENSES.md`.

## Scale and QA

Raw grids first receive DPI normalization to square pipeline cells. The hit sheet's external black letterboxing is cropped with recorded bounds; no character pixels are cropped. One locked character scale, **208 / 231**, then applies across every clip and future direction. Alignment changes translation only. `character-calibration.json` and `E/dpi-calibration.json` record both stages. No frame-specific scaling is used.

E/SE/S/NE each export one **2048 × 2048 PMA atlas**; N uses 2048² + 512² pages. Every direction contains all 156 regions in one armature. Upright heights: E idle 207–210 px, walk 214 px, run 204–207 px; SE idle 209–213 px, walk 205–213 px, run 208–213 px. Seated, lunge, death-collapse and bow exceptions are explicit per-cell entries in the projects; the original anatomy remains at the common scale. The contracts record their measurements. SE uses a 2×2 hit layout to avoid letterboxing; E preserves its existing four-across source.

The completed E/SE/S/NE/N contracts have **zero hard failures**, no unlisted soft finding and no regression: E has **26 accepted findings**, S has **32**. SE has **26 accepted findings**: 15 free-pose findings and 11 newly measured 2D foot findings. See `quality-backlog.json` / `.md` for exact clip, direction, cell, metric, value, limit and repair note. The JSON's `entries` use the public automated backlog format. Its public `manual` array records observations outside automated gates: weak leg reversal, two E gray talismans, residual violet-spill pixel counts for all cells, and the directional validation limitation below. `manual-art-findings.json` preserves the per-cell numeric evidence and imports through `sprite:backlog --backlog <quality-backlog.json> --import-manual <manual-art-findings.json>`; the shared importer retains those numbers in each observation's note. There are 159 E records and 176 SE observations after retaining 16 updated spill measurements alongside earlier evidence. These stay open; never infer they are resolved because a gate does not emit them. Regenerate this manual section with `record-visual-qa.ts` after the final export.

The merged shared foot-slide gate projects ground travel into the facing direction. SE/S/NE/N use newly regenerated directional QA guides, source y stride (`vertical: keep`) and the new non-E metric IDs. SE archives its original horizontal generation inputs byte-for-byte, removes the legacy opt-out, and measures both ground-motion axes. Its 13 retired x-only baselines are retained as migration history, not represented as art fixes. Weak leg reversal and palette spill remain open.

E run cells 3 and 8, and SE run cells 2 and 7, were repaired locally; each splice verified the other nine cells byte-identical. E meditation attempt 2 replaces enlarged seated anatomy. SE meditation attempt 2 replaces a stand/sit transition with sustained seated poses; SE channel attempt 2 fixes the seam and upper-torso visibility. All other clip sheets use their first generation. No clip has exceeded the reroll limit.

Exact prompts, tool output IDs and UTC times are in `provenance.json` and each direction’s `sheets/*.generation.json`. Model: **undisclosed by tool**. All generated art remains an internal AI placeholder; release approval and license review are outstanding. Per-file rows are in `docs/ASSET-LICENSES.md`.

## S direction

All 15 S sheets contain 156 selected cells at the same locked 208/231 scale. Cell-local height repairs affected idle cell 11 and emote cells 9, 10 and 11; each splice verified every other cell byte-identical. The complete merged-main build has zero hard failures, zero unlisted soft findings and zero regressions, with 32 explicitly recorded accepted findings and 156 open per-cell spill observations. The original E/SE/S checkpoint had 86 metric entries and 475 manual observations; current counts include the SE migration below.

S exports all 156 regions in one 2048² PMA atlas with one armature and the unchanged locked scale. `S/dpi-calibration.json` records all 15 grids. Every serialized gameplay event matches the shared table, and all 15 clips loaded in real Cocos3.8.8 zoom2/midpoint GIF/contact captures. Main #122 supports multi-page output when needed; S currently fits one page after the source-y-preserving alignment. Original S walk/run generation PNGs and manifests remain byte-preserved in `S/generation-templates/`, with SHA-256 records. The `S/templates/` gait files are newly generated directional QA inputs, identified by their tooling commit. Generation metadata points to the original archived inputs.

`S/clip-overrides.json` is character-owned pose data: upright attack sheets retain their master identity checks without lunge exemptions; emote cells 6/7 are actual bows; walk/run retain source y stride with `vertical: keep`. The thin preparation helper reads this optional data and retains public clip-table event defaults. The helper passes the direction to the merged API. S currently uses the documented first-pass default stanceWidth=0; per-cell foot-slide/ghost findings remain in the backlog for later art improvement.

## NE direction

NE adds 15 clips / 156 frames in one 2048² PMA atlas at the unchanged 208/231 scale. The declared project and shared batch pass with zero hard/unlisted/regression findings and 28 accepted metric findings. All 15 event timelines match shared defaults; every clip loaded in real Cocos3.8.8 zoom2 midpoint captures.

The original gait generation PNGs/manifests and SHA-256 hashes are in NE/generation-templates; current QA templates are freshly regenerated from merged main. Original metadata reference aliases are retained alongside corrected character-root-relative references. Walk and meditation use their second whole-sheet generation; run cells1/4/6 and emote0/1/2/3/5 use cell-local repairs. NE/repair-proof.json confirms every unselected raw cell stayed byte-identical.

NE retains 156 per-cell spill observations and 9 explicit weak-reversal observations (walk4–7; run5–9). Each observation includes clip/cell/metric/value/limit in the companion and shared manual note. No manual finding is automatically resolved. The original E/SE/S/NE checkpoint had 114 metric entries and 640 manual observations. Existing art observations remain intact; see the SE migration below for current counts.

## N direction and full set

N completes all five drawn directions: E, SE, S, NE, N (the west side mirrors through the shared direction model). Each direction has 15 clips / 156 cells: **75 clips / 780 source cells** overall. The committed batch lists all five declared projects.

N has zero hard/unlisted/regression findings and 44 accepted measurements at the unchanged 208/231 scale. One armature uses two PMA atlas pages, 2048² and 512², containing 150 and 6 regions. The second page contains sword_fly cells 0/1/5/6/7 and emote cell 7; real Cocos3.8.8 zoom2 midpoint captures show these mixed-page frames correctly. All 15 N clip/event timelines were verified. Copy the complete export folder, including the contract and both atlas PNG/JSON pairs.

All 15 N raw source PNGs are byte-identical to their first tool outputs; see N/source-integrity.json. Original gait generation inputs remain archived with hashes, while current QA guides are regenerated with merged public tooling. Actual bow/recovery cells 6/7/8 have explicit pose reasons; standing attacks keep master identity checks without lunge exemptions.

N retains 156 per-cell spill observations and 9 minor belt-accessory redraw observations (run cells 1–9), all open. Across all directions the shared backlog contains **156 metric entries and 821 manual observations**, with no automatic art resolutions. SE directional migration is recorded below. Later cell-local improvement must not change anatomical scale or discard frames.

## SE directional QA migration

SE walk/run QA templates now use the public SE ground vector and `vertical: keep` with documented default stanceWidth=0. `SE/clip-overrides.json` preserves every existing pose exception and adds only gait alignment. Painted sheets, anatomy, the 208/231 character scale and gate thresholds are unchanged. `SE/generation-templates/sha256.json` verifies the archived original PNG/manifest bytes; source generation metadata points to those original guides. `SE/qa-migration.json` records all 13 retired x-only baselines. Fresh exact 2D findings are reviewed separately: 11 foot-motion warnings plus 15 existing free-pose warnings, with zero hard, unlisted or regression findings.

All earlier manual observations remain recorded, including 16 previous spill measurements whose current resampling counts differ. No visual defect is resolved by absence from automatic QA.

Explicit art-worker review resolved only the two historical SE `unverified_screen_motion_axes` observations after inspecting fresh walk/run Cocos captures and the new 2D measurements. Their original numeric diagnostics are preserved as history. The full shared manual backlog retains **821 observations: 819 open and 2 resolved validation records**; all painted-art findings remain open. All 15 SE serialized event timelines still match the public clip table.
