# Thể tu premium semi-chibi v1

Original premium semi-chibi source set. The old `the-tu-sprites-v1` set is untouched. E, SE and S each contain 15 clips /202 drawings using D46 smooth-v2; all three pass real Cocos2x capture, and NE/N motion remains in production.

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

Gauntlets are naturally worn in full frames. Tooling27 confirms these are D45 extraction sources; the current full-source compatibility export has one body slot and is not a layered runtime delivery. D45 schema/composer, extraction/export CLI and layered Cocos runtime are now merged; reviewed gauntlet-removal edits/mattes/contacts remain a follow-up after the full-frame directions are locked. T2-T5 and costumes will be AI edits of completed T1 motion sheets. Quality grades are runtime glow/trim tint only.

## Validation status

Full E sprite build: 0 hard failures, 0 unlisted soft failures, 38 current accepted soft findings (25 locomotion, 13 small attack_2 bbox differences), 0 regressions. The stored backlog also retains one resolved historical E run15 entry, so its39 stored E metric rows are not39 current findings. Those findings remain in the quality backlog; no threshold was relaxed. Pose exceptions remain explicit in `E/project.json`. Export: 202 regions on two MaxRects atlas pages in the new `dragonbones/the-tu-chibi-v1` folder. Cocos Creator 3.8.8 capture passes for all15 clips at2x,24 midpoint samples each, with15 GIFs and15 contact sheets. All root verification commands pass, plus22 committed-project audit tests including this project. See E/validation.json and E/cocos-capture.json; review media live in the session artifact, not the git repository.

### D47 / headroom correction

Run, attack_2 and channel select their `.headroom.png` AI edits: compact secondary buns remove actual top-edge clipping while preserving dynamic poses and one fixed calibration. `E/head-evidence.review.json` records 17 manual skull crown/chin measurements for run/dash, not detector certification. `E/canvas-bounds.review.json` audits all202 keyed source bounds plus their fixed translations: no bounds lost. Earlier raw attempts and repair proofs remain historical sources; `E/project.json` is the selected-sheet registry.13 small attack_2 bbox-height findings remain explicit soft debt rather than being hidden by an exception.

## SE motion checkpoint

SE uses its pinned47.82px crown/chin baseline cross-checked by style-owner23,34 manually annotated aligned head cells and diagonal keep alignment. Six dash cells use AI head correction with10othergroup cells byte-identical; attack/cast secondary buns were reduced to eliminate clipping. Full15clip hard QA and real Cocos3.8.8 2x capture pass.39 explicit soft findings remain:25 foot contacts/slides and14 free-clip bbox differences. The walk color-label mistake and rejected7regression feet edit are documented without replacing the better source. All root checks pass; after-runtime158 compatibility smoke passes for run/attack_3 at2x. See SE/validation.json and SE/cocos-capture.json. Canonical E/SE extraction guides were generated with the merged CLI, not hand-authored layer manifests.

## S motion checkpoint

S uses the locked frontal master and15 aligned manual head annotations against its independently refined48.04px maincap-to-centraljaw baseline. The refinement excludes the gold fitting; unchanged master hash and earlier measurements are retained in `S/head-evidence.review.json`. Head-only AI edits preserve run flight and deep dash posture; an overcorrected shallow-dash attempt remains rejected in provenance. Cast secondary bun edits clear actual clipping. Die uses one reviewed lattice-root X across all12cells to preserve authored rightward collapse without centroid clipping. No individual frame fitting or body rescaling.

All15clips/202drawings pass native hard gates after latest-main tooling integration.53 current soft findings remain explicitly backlogged (25 footSlide, 28 height);0 unlistedsoft/0regression. Real Cocos3.8.8 2x capture passes for all15clips with24 midpoint samples each; all required root checks pass after latest-main integration. See `S/validation.json`; final raw selection is `S/project.json`, with original attempts, exact prompts, undisclosed model, UTC and repair hash proofs retained.
