# Thể tu premium semi-chibi v1

Original premium semi-chibi source set. The old `the-tu-sprites-v1` set is untouched. E contains 15 clips / 202 drawings using D46 smooth-v2; other directions currently contain reference masters only.

## Master checkpoint

- Identity reference: owner-approved worker 23 `the-tu-t3.raw.png` (2026-11-07).
- T1 plain charcoal wrap, ivory ink-wash apron under amber broad hip sash, simple paired worn gauntlets with bronze bands.
- `reference/T1-turnaround.png`: keyed apron-corrected E, SE, S, NE, N left to right; W directions mirror at runtime under the direction contract. `T1.master-native.png` is the SE reference panel; `<DIR>.master-native.png` contains all five native crops. `<DIR>.master.png` and `T1.master.png` are 256-square references using one uniform scale, recorded in `character-calibration.json`.
- `reference/T1-T5-front.png`: keyed apron-corrected front outfit reference strip, T1 through T5, with separate `T<n>.front-native.png` crops. These are not registered motion edits. Earlier attempts remain as raw sources.
- Both raw images retain their original alpha and pixels. No individual pose has been rescaled or painted by code.
- Exact prompts, tool, undisclosed model, timestamps and input paths are in the adjacent provenance files.

## Review findings

The final turnaround silhouettes measure 669, 667, 667, 667, 667 native px high at alpha >=128. These whole-alpha diagnostic heights include the topknot and are not anatomical H. The owner selected main-hair-cap crown to sole H = 216 px at 2x, ground 232 in a 256 cell. After style-owner landmark advice, AI edits slightly raised the main cap, broadened shoulders and reduced only the elevated bun. One reference scale 216/640 is applied to every view; all five fit with over 6 px top headroom. Manual front construction landmarks and ratios are recorded separately from alpha metrics in `character-calibration.json`; they are art measurements, not automatic anatomy certification. No per-frame fit is used. Eyebrow nick readability and minor skin highlights/facets remain art findings. T5 separation was improved with broader panels and detached gauntlet pieces.

Transparent edits produced colored fringe; those raw attempts are retained and superseded. Current clean references use opaque magenta AI sources followed by the existing sprite `keyOut` and `defringe`; turnaround also runs `removeFragments` (0 removed). Native crops have no resampling. `master-panels.json` records processing and measurements. `T1-proportions.attempt1.magenta.raw.png` is an unverified candidate and is not the current reference.

## E motion production

Generated from merged D46 defaults (`smoothProjectClipDefaults`) and official direction-aware templates, at most 4x4 cells. Each clip uses one generation call except the rejected nonsquare first attack attempt; hit and dash share a 16-cell sheet through the subsequently merged grouped tooling. Raw outputs and original guides are retained. Motion preparation uses declared square-cell DPI conversion and locked scale 1 across the complete direction. No individual frame fitting or atlas downscaling.

Counts from D46: idle/walk/run/cast/meditate/tribulation 16; dash 10; attack/attack_2/attack_3 14 each; channel/die/emote/sword_fly 12; hit 6. Nominal 24 fps, duration/event anchors from the public v2 defaults. Runtime first attack remains `attack`. The project records explicit seated, airborne, lunge, crouch, recoil and collapse exceptions for visible affected poses. Hair/ribbon/sash lag is drawn into the sheets.

Gauntlets are naturally worn in full frames. Tooling27 confirms these are D45 extraction sources; the current full-source compatibility export has one body slot and is not a layered runtime delivery. Body/weapon/FX extraction/composition remains pending tooling. T2-T5 and costumes will be AI edits of completed T1 motion sheets. Quality grades are runtime glow/trim tint only.

## Validation status

Full E sprite build: 0 hard failures, 0 unlisted soft failures, 26 accepted soft locomotion findings, 0 regressions. Those findings remain in the quality backlog; no threshold was relaxed. Pose exceptions remain explicit in `E/project.json`. Export: 202 regions on two MaxRects atlas pages in the new `dragonbones/the-tu-chibi-v1` folder. Cocos Creator 3.8.8 capture passes for all15 clips at2x,24 midpoint samples each, with15 GIFs and15 contact sheets. All root verification commands pass, plus22 committed-project audit tests including this project. See E/validation.json and E/cocos-capture.json; review media live in the session artifact, not the git repository.
