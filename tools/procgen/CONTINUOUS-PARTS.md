# Continuous-part preparation

`scripts/continuous_parts.mjs` prepares separately generated full-canvas art. Defaults retain the Kiếm tu E workflow. Other characters supply their own geometry, palette samples and registered master; no game dependencies or environment changes are required.

```sh
node tools/procgen/scripts/continuous_parts.mjs masks <temporary-mask-dir> --source assets-src/placeholder/the-tu-continuous-v1 --dir E
node tools/procgen/scripts/continuous_parts.mjs process <temporary-report.json> --source assets-src/placeholder/the-tu-continuous-v1 --dir E
node tools/procgen/scripts/continuous_parts.mjs check <temporary-registration.json> --source assets-src/placeholder/the-tu-continuous-v1 --dir E
```

Options, relative to the repository root (absolute paths also work):

- `--source`: class source root. Input `raw/<dir>/<id>.png`, output `<dir>/<id>.png`.
- `--dir`: direction, default `E`.
- `--manifest`: geometry manifest, default `<source>/<dir>.parts.json`.
- `--master`: registered 512×512 RGBA @4x master, default manifest `reference4x` or `<source>/reference/<dir>.master4x.png`.

The generation reference may be retained separately. Use the **registered** master for palette/outer-silhouette preparation. Store the actual generation reference and masks in provenance; changing a registration guide does not change the history of the generation input.

Minimal geometry manifest (coordinates are @2x texture pixels, x right / y down):

```json
{
  "reference4x": "assets-src/placeholder/the-tu-continuous-v1/reference/E.registered4x.png",
  "reference2x": "assets-src/placeholder/the-tu-continuous-v1/reference/E.registered2x.png",
  "paletteSamples": {
    "cloth": [[100, 80, 110, 100]],
    "skin": [[120, 50, 130, 60]],
    "boots": [[115, 215, 125, 225]]
  },
  "paletteFilters": {
    "cloth": { "minLuma": 145 },
    "skin": { "minLuma": 80 }
  },
  "edgeDefringe": true,
  "parts": [
    {
      "id": "leg_R",
      "materials": ["cloth", "boots"],
      "registration": "contour",
      "polygons": [
        [
          [110, 120],
          [125, 120],
          [125, 220],
          [110, 220]
        ]
      ],
      "materialRegions": [
        {
          "material": "boots",
          "polygon": [
            [100, 205],
            [145, 205],
            [145, 235],
            [100, 235]
          ]
        }
      ]
    }
  ],
  "restOrder": ["leg_R"]
}
```

The numbers above are schema examples, **not Thể tu landmarks or sample regions**. The art owner must author them for their master.

`paletteSamples` is required for another character; each rectangle is inclusive. Samples use master alpha ≥240. Optional filters are `minLuma`, `maxLuma`, `minRedMinusBlue`, `maxRedMinusBlue`, `minGreenMinusRed`, `minGreenMinusBlue`. Other characters have no implicit Kiếm tu filters. Use explicit `materialRegions` for mixed pieces: regions are tested in order; remaining pixels use the first material when regions are supplied. Every material needs non-empty master samples.

Masks accept `polygons` and rounded `segments` (`{a:[x,y],b:[x,y],r:number}`). `registration` chooses `contour` (continuous cross-sections) or `bounds` (preserves generated feature shape). The default retains existing structural-name rules. Optional per-part `sourceBounds4x: [x0,y0,x1,y1]` clears pixels outside inclusive bounds on the normalized 512 canvas before registration; use it to select an ivory sleeve without a generated blue shoulder cap. It does not crop/recenter the shared canvas. Optional `edgeDefringe` replaces unusually light semitransparent edge RGB with the nearest opaque interior colour, without eroding alpha; it defaults off to retain existing Kiếm tu pixels.

Outputs are **256×256 straight-alpha PNGs**. PMA conversion belongs only to packing/export. `check` independently measures the complete rest composite against `reference2x` (or an area downsample of the registered @4x master), reporting maximum boundary distances in both directions; it fails above 2 texture px. It does not validate animation, mesh deformation or style. `restOrder` must list active rest displays only, excluding the shadow/effects and inactive swaps.

Optional per-part `materialAliases`, for example `{"skin":"gold"}`, remaps the inferred colour classifier for mixed-material pieces. Explicit `materialRegions` always win, and a single-material part keeps its declared material. Defaults are unchanged.

Optional `silhouetteMargin4x` sets the Euclidean master-alpha dilation radius at the 512 stage (default 3, range 0–16). A tighter value such as 2 can reduce diagonal overshoot after downsampling. This is a processing margin, not an acceptance threshold: the independent `check` still requires maximum extra and missing boundary distances ≤2 px @2x.

The `licenses` subcommand remains Kiếm tu E specific; other art workers maintain their own prompt/tool/model-undisclosed/CLI/UTC provenance. Existing no-option commands and the legacy `masks <out> <manifest>` form remain supported.
