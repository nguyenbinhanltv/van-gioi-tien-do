# Phap Tu B — Vermilion Fan Adept

Owner choice: **B**, 2026-11-06, D42. A was considered and superseded; its production files are excluded from this change.

The open cyan/teal folding fan stays in the anatomical right hand in every clip, including locomotion. Vermilion/ivory robes, navy sash, bronze trim, jade pin and red ribbon follow the B master. Fire/water waves are separate VFX and are not baked into the body sheets.

## Scope and calibration

- Five reference directions: E, SE, S, NE, N. Opposite-side directions mirror under D14.
- This production project currently contains **E only**, all 15 clips and 126 drawn frames from public `SPRITE_CLIPS` / `projectClipDefaults`.
- Master heights: E 208 px, SE 209 px, S 208 px, NE 207 px, N 208 px.
- Raw sheets are preserved as `*.generated.png`. `prepare.ts` converts each whole sheet uniformly to template DPI, rejecting a mismatched aspect ratio. It never scales individual frames.
- Character calibration is locked at `208 / 237`, recorded in `calibration.json`, and reused by the E project.
- Run cells **4 and 10** received local anatomical redraws. `run.repair.json` proves that all other cell bytes stayed unchanged; the edited source and exact prompt are retained.
- Every generation record includes the exact prompt, tool, **model undisclosed by tool**, UTC start/end and relative references. Per-file source/license rows are in `docs/ASSET-LICENSES.md`.

## Current verification status

All 15 E clips export into **one 2048 x 2048 PMA atlas, 126 regions**. Presence and loop seam pass. Upright height and unexceptioned standing similarity pass after the two run repairs. Idle/run load in real Cocos Creator 3.8.8 at zoom 2 with midpoint sampling.

**The full project is still failing strict QA and is not ready to publish.** The current contract retains 12 hard torso-similarity findings: meditate cells 0–7 and die cells 4–7. There are also 26 unlisted free-pose height warnings and 17 explicitly accepted gait findings.

The orchestrator approved D41's `seated` / `die-collapse` declarations for those explicit ranges, but automatic approval review requires direct user approval before applying them. No exception has been applied. These ranges total **12 cells**. If approved, their generic standing face/torso comparison will be skipped by the existing pipeline; the raw measurements must remain visible and the owner must judge those poses visually. Die cells 2–3 are not included in that proposal.

## Quality backlog

- [Measured backlog](quality-backlog.json) and its [generated table](quality-backlog.md): public worker-15 format, direction/clip/cell/metric/value/limit, no hard finding accepted.
- [Visual backlog](quality-backlog-visual.md): manual first-pass findings with explicit reviewed cells/counts. These are not automatic gate overrides.
- Floating red fragments on the raw turnaround are an input finding. Direction crops use public fragment removal; production sheets use public keying, defringe, fragment removal and palette-aware spill cleanup. Real captures still need final per-clip visual inspection for robe halos.
- A diagnostic across all 126 sliced frames found **0 detached red components** with alpha >=128, area >=24 px, outside the main component bounds plus 6 px, and average red above 1.3 times green/blue. The slicer removed 1 fragment in total. This covers detached fragments; attached robe-edge halos remain a visual review item. No obvious floating red fragments were seen in the real idle/run pilot.

## Reproduce

Run from the repository root:

```sh
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/phap-tu-fan-sprite-v1/prepare.ts
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/phap-tu-fan-sprite-v1/E/project.json --out <temporary-output>
npm run sprite:backlog -w @vgtd/sprite -- --project assets-src/placeholder/phap-tu-fan-sprite-v1/E/project.json
npm run sprite:batch -w @vgtd/sprite -- --batch assets-src/placeholder/phap-tu-fan-sprite-v1/batch.json --out <review-output>
```

`sprite:batch --capture` currently resolves the bundled script's repository root incorrectly; reported to the owning worker. Direct `apps/client-cocos/scripts/capture.mjs --zoom 2 --sample midpoint --mode single --direction E --stem phaptu --animations all --gif` is the capture fallback, after staging the export in its `--src` resource directory. Gate failures remain failures during review capture.
