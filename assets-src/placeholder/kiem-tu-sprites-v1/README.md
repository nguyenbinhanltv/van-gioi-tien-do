# Kiếm tu concept A — E sprite source candidate

D41 player-body frame animation; 60 full-character drawings in seven sheets.

```sh
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/kiem-tu-sprites-v1/E/project.json --out <temporary-directory>
```

The command passes the D41 backlog policy: zero hard failures,14 accepted soft foot findings,zero regressions. This is an owner-review candidate, not zero-slide production acceptance. See E/quality-backlog.json and its generated Markdown report. All upright frames pass master height ±3%, coarse face/torso similarity, presence and raster loop seam. The master is 208 px high at 2x.

Run/walk contain 12 drawings each; idle, attack, cast and die 8 each; hit 4. Source attack_1 uses the existing runtime name attack. Fixed calibration per sheet handles generation DPI; no per-frame stretching. Lunge, recoil, raised-sword and collapse exceptions are recorded explicitly. Shared pipeline handles chroma key/defringe, master palette, pelvis/sole alignment, trimming,2048 PMA atlas/padding 2/extrude 1 and DragonBones display swaps.

## Known issues

- Fourteen corrected-metric foot findings remain (six run template offsets; six walk slides and two walk template offsets). Initial generation guides used insufficient stride; corrected speed-derived run regeneration was rejected because its foot travel was worse. Exact source generation guides remain here for provenance.
- Clear right/left reversal, run half-cycle hair/arm continuity need further work. Shared interior spill cleanup is enabled; no thresholds or gameplay speeds changed.
- Attack contact drawing 5 maps to exported hit event tick 7/13; cast release drawing 5 maps to tick 8/15.
- The single-root viewer bone seam metric is not raster sprite QA. Actual Cocos 1x/2x captures and old-rig comparison are session artifacts, outside the repository.

## Provenance

See provenance.json and docs/ASSET-LICENSES.md. Source sheets are AI outputs with deterministic masked/cell repairs; no manually painted final pixels. Rejected generation attempts remain in the provenance log, not as selected art. Prompts are exact; model undisclosed by tool; codex-cli 0.166.0. The reference is the existing project-owned concept-A E art.
