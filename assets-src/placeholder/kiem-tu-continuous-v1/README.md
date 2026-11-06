# Kiếm tu concept A — continuous parts

Direction E pilot for D39 / TRACK 2. Other directions wait for E animation QA and owner review.

All 57 source pieces are separate full-canvas **256×256 straight-alpha RGBA PNGs** in `E/`. Shared registration uses x right, y down, @2x texture pixels; `E/landmarks.json` is authoritative for the neutral bones, root `(128,232)`. Do not decode these PNGs as already premultiplied. The atlas pack/export converts them to PMA.

| Group                                                     |  Count |
| --------------------------------------------------------- | -----: |
| Whole arms/legs, torso, vest, front/back/inner robe       |      9 |
| Five hand swaps per side                                  |     10 |
| Face base, three eye states, brows, three mouths          |      8 |
| Back hair, bun, ponytail, three strands, pin, two ribbons |      9 |
| Sash belt, knot, two tails                                |      4 |
| Jade pendant and tassel                                   |      2 |
| Cuffs, linings, vest edges, boots, front/back hems        |     10 |
| Drawn sword, empty scabbard, glint, trail, soft shadow    |      5 |
| **Total**                                                 | **57** |

`raw/E/<id>.png` retains the selected imagegen output. `<id>.generation.json` records the full prompt, tool/model disclosure, CLI version, UTC and reference paths; `<id>.mask.png` retains the actual generation mask. The tool may return a larger raster than requested; normalization uses the entire canvas. `reference/E.master4x.png` is a premultiplied Lanczos resample of the canonical @2x concept-A turnaround, with no repainting.

`E.parts.json` supplies the final neutral registration guides and material regions. These guides can differ from generation masks after measured silhouette corrections. Structural parts are fitted by continuous cross-sections; small face features and hair retain their generated shape with area-weighted bounds registration. Hidden limb/hip coverage is painted in the full generated pieces, rather than cut from the finished master. The process removes stray alpha, transfers each material toward samples of the master palette, constrains the rest silhouette, and downsamples to @2x. It does not establish animation acceptance.

Run from the repository root:

```sh
node tools/procgen/scripts/continuous_parts.mjs masks <temporary-mask-directory>
node tools/procgen/scripts/continuous_parts.mjs process <temporary-processing-report.json>
node tools/procgen/scripts/continuous_parts.mjs check <temporary-rest-report.json>
node tools/procgen/scripts/continuous_parts.mjs licenses
npm run rig:assemble -w @vgtd/rig -- --parts assets-src/placeholder/kiem-tu-continuous-v1 --out <temporary-export-directory>
```

The source check compares the neutral layered composite against the canonical master at alpha ≥128. The measured outer-boundary distance must be ≤2 texture pixels in both directions. Hidden effects/shadow and inactive face/hand swaps do not enter that rest comparison. The separate acceptance gate measures the **assembled** rig and captures idle/run/attack in Cocos with detail animation enabled; zero QA errors alone do not prove zero seam openings, tears or stretch.

Provenance and complete prompts: `docs/ASSET-LICENSES.md`, KT3. Placeholder status and release review requirements are inherited from KT2.
