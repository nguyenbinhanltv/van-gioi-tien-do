# Thuong tu premium semi-chibi v1

Owner-approved male option C under D51. The navy/ivory/red/gold vanguard carries a straight spear with a forked red banner. Loi remains a proposed element; this source set does not lock gameplay or balance.

## Canonical T1 reference

The selected five-view source is `reference/T1-turnaround.raw.png`, E/SE/S/NE/N from left to right. T1 uses a plain sleeveless navy wrap with ivory undercollar, red sash and short tails, compact dark trousers, wraps and small boots. The plain steel spear has a red pennon; no T3 armor, jewel or emblem is carried into T1.

`reference/identity-lock.json` records the adult male face and swept fringe/low ponytail. Front and profile features were reviewed manually; rear faces are occluded and are not claimed as measured. The raw source, preceding attempt and original identity input retain their pixels and adjacent exact generation prompts. Model identity is not exposed by the built-in tool.

Run from the repository root:

```sh
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/thuong-tu-chibi-v1/prepare-masters.ts
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/thuong-tu-chibi-v1/prepare-motion.ts
```

Master preparation keys magenta with the public pipeline, removes fringe/fragments, crops at measured whitespace gaps and applies **one 216/680 scale** to all views. `reference/anatomy-landmarks.json` stores manual main-hair crown/sole landmarks and uncertainty; `character-calibration.json` stores transforms and separate alpha bounds. Anatomical heights are 214.7–216.3 px, within D44's 216 px band. The spear and secondary hair do not set body height. No view or frame is independently fitted or painted by code.

NE/N use D50 crown-to-visible-shoulder-midpoint plus skull breadth because the approved low ponytail hides the nape. No chin or skull base is invented. The body shoulder band is locked to 24-28% H (lean), measured S 25.5% +/-0.9%. T2-T5 armor may overhang. This is an art measurement, not a gameplay constant.

## E production

Public smooth-v2 defaults supply all 15 clips / 202 drawings. Templates use anatomical guides and public direction-aware locomotion ghosts. Fourteen 4×4 source lattices cover the set: hit6 and dash10 share a sheet, and short clips select explicit cells. Exact unscaled master head crops are blitted into the reference stencils; these guides do not certify actual frame anatomy.

The normalized source calibration is explicit in `motion-calibration.json`. The initial idle source measured approximately 224 px main-crown-to-sole at scale 1; a single 216/224 scale corrects its source-wide enlargement. The same scale applies to every cell, with no per-frame fitting or canvas-loss exception. Motion uses the merged opt-in Lanczos3 path: native DPI and placement are composed once. The approved master PNGs retain their original pixels and calibration.

See [E/README.md](E/README.md) for the full-source compatibility delivery, exact reproduction commands, measured head/D54 results, matte checks, real Cocos capture and explicit gait debt. D45 removal-edit references are recorded by command/input/output hashes; their derived PNGs are reserved for the later extraction pass.

`generation-index.json` links every production imagegen call to retained input/output PNGs, dimensions and SHA-256 evidence. Exact prompts and observed UTC remain in adjacent provenance. Historical candidate status records the original review stage; `E/project.json`, repair proofs and validation identify the selected production set.
