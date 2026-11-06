# Deterministic character-part preparation

`scripts/continuous_parts.mjs` prepares registered, transparent character parts from an
explicit master and geometry/material manifest. It contains no character art, palette
coordinates or character-specific license writer.

The workspace entry point is `npm run prep:parts -w @vgtd/procgen -- <mode> <flags>`.

```bash
node tools/procgen/scripts/continuous_parts.mjs process report.json \
  --source assets-src/placeholder/my-character \
  --dir E \
  --manifest assets-src/placeholder/my-character/E.parts.json \
  --master assets-src/placeholder/my-character/reference/E.register-master4x.png

# Same inputs; independently measure the rest composite against the master.
node tools/procgen/scripts/continuous_parts.mjs check registration.json \
  --source assets-src/placeholder/my-character --dir E

# Generate full-canvas part-region guides before image generation.
node tools/procgen/scripts/continuous_parts.mjs masks /tmp/part-guides \
  --source assets-src/placeholder/my-character --dir E
```

Paths supplied in flags or `reference4x`/`reference2x` resolve from the repository root;
absolute paths are supported. `--source` is required. The manifest defaults to
`<source>/<dir>.parts.json`; the direction defaults to `E`. `--master` overrides
`reference4x`, otherwise `<source>/reference/<dir>.master4x.png` is used. Masters are
512x512 RGBA. Palette and geometry coordinates are in the corresponding 256x256 @2x
canvas, x right/y down. `paletteSamples` rectangles have inclusive bounds.

`masks <output-directory> <manifest-path>` also accepts the manifest as a third positional
argument. `--manifest` takes precedence when both are supplied.

```json
{
  "reference4x": "assets-src/placeholder/my-character/reference/E.register-master4x.png",
  "paletteSamples": {
    "cloth": [[100, 100, 110, 120]],
    "gold": [[115, 100, 118, 120]]
  },
  "paletteFilters": { "cloth": { "minLuma": 145 } },
  "edgeDefringe": true,
  "silhouetteMargin4x": 2,
  "parts": [
    {
      "id": "sleeve",
      "materials": ["cloth", "gold"],
      "registration": "contour",
      "polygons": [
        [
          [100, 85],
          [115, 85],
          [120, 140],
          [100, 140]
        ]
      ],
      "sourceQuarterTurns": 0,
      "sourceBounds4x": [0, 180, 511, 440],
      "materialRegions": [
        {
          "material": "gold",
          "polygon": [
            [100, 135],
            [120, 135],
            [120, 140],
            [100, 140]
          ]
        }
      ]
    }
  ],
  "restOrder": ["sleeve"]
}
```

Input pieces are `<source>/raw/<dir>/<id>.png`, straight alpha at any square resolution;
they are normalized to 512 before processing. Outputs are full-canvas
`<source>/<dir>/<id>.png`, **256x256 straight alpha**. Packing/export owns PMA conversion;
do not premultiply these source PNGs. Existing atlas packers are unchanged. Continuous
rig packing remains in `@vgtd/rig`; this CLI does not export or repack a rig.

The processing order is normalization, optional clockwise quarter turns, source-region
selection, alpha cleanup, registration, exclusions, palette transfer, master-silhouette
clamp, optional defringe, then alpha-weighted area downsampling. Palette transfer blends
75% ranked master samples with 25% generated colour. Alpha cleanup removes disconnected
speckles and translucent haze away from opaque paint. Defringe replaces unusually light
semitransparent edge RGB with the nearest opaque interior colour without changing alpha.

- `paletteSamples` is required and may use arbitrary material names. Optional filters:
  `minLuma`, `maxLuma`, `minRedMinusBlue`, `maxRedMinusBlue`, `minGreenMinusRed`,
  `minGreenMinusBlue`. Luma uses 0-255; channel-difference thresholds may be negative.
- `materialRegions` are tested in order and override inferred colour labels. Remaining
  pixels use the first declared material when explicit regions are supplied. A single
  material always uses that material. Otherwise a coarse cloth/skin/hair/blue/gold
  classifier applies; optional `materialAliases`, such as `{"skin":"gold"}`, remaps it.
  Every region material must be declared in the part's `materials` list.
- Guides combine `polygons` and rounded `segments` (`{ "a":[x,y], "b":[x,y], "r":5 }`).
  `registration: "contour"` fits continuous cross-sections; `"bounds"` keeps feature
  shape while fitting its bounds. Common structural arm/leg/torso/robe names default to
  contour fitting; other IDs default to bounds. Explicit registration is recommended.
  Contour fitting needs source paint with alpha >=128; use bounds registration for
  uniformly translucent pieces to retain their opacity.
- `sourceQuarterTurns`: clockwise 0-3, default 0, before `sourceBounds4x` selection.
  Bounds are inclusive `[x0,y0,x1,y1]` on the rotated, normalized **512** canvas; they
  clear outside pixels without recentering.
- `excludePolygons`: registered @2x polygons cleared after fitting, for neckline or
  other interior windows. They preserve the outer registration contour.
- `clipToMaster: false`: let an inactive display swap keep a different silhouette.
  Its geometry guide still applies. Default true; shadow/trail/glint are exempt.
- `silhouetteMargin4x`: Euclidean master-alpha dilation radius at 512, default 3,
  range 0-16. Tighten it to reduce diagonal overshoot after downsampling.
- `restOrder`: active rest displays, back to front; exclude inactive swaps/effects.
  `check` requires declared, unique IDs in this list. It compares the complete rest alpha composite with
  `reference2x`, or an area downsample of the registered master if omitted, and fails
  if either maximum boundary distance exceeds **2 texture px** at alpha >=128. A
  processing-margin change never relaxes this independent threshold. Distances larger
  than 20 px are capped at 20 in the report and still fail.

`process` permits partial generation cohorts (missing raw files are skipped and their IDs
are listed on stderr). `check`
requires every manifest part output. Its report validates rest registration, not mesh
deformation, lighting, animation, or style. Keep generation prompts, tool/model/CLI/UTC
and manual processing provenance with the source asset and the project's license log.
