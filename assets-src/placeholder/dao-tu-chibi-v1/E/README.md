# Dao tu T1 E — smooth-v2 full-source motion

Storm Reaver A: male, lean build, low loose black ponytail, grey eyes, storm grey-blue over dark muted teal, and a heavy mountain-ink dao. The canonical T1 is deliberately plain. The approved concept lineage comes from worker 32; that worker owns the D51 decision entry for both new classes.

This direction delivers the D41 **full-source compatibility motion**, not extracted body/weapon/FX runtime sets. Per orchestrator scope, the D45 extraction pass follows after all five T1 directions merge. Derived layer-guide PNGs are not part of this PR; `layer-guides.provenance.json` records the exact reproduction command, project/master hashes, `layer-inputs.json` hash and all 14 guide hashes with their clip/cell mapping.

## Sources and calibration

- `project.json`: official smooth-v2 defaults, 15 clips / 202 drawings, 24 fps authoring; exported clock/event quantization remains owned by the public sprite exporter.
- `../reference/`: native source attempts, selected turnaround, canonical normalized masters, T1–T5 front edit references, prompt/UTC lineage, measured landmarks and SHA-256 index.
- `../character-calibration.json`: one anatomical scale across the five turnaround views, S exactly 216 px; weapon and loose hair remain separate alpha diagnostics.
- `../motion-calibration.json`: fixed scale 1 after whole-sheet `square-cell-dpi-v1` preparation. No individual frame fitting or rescaling.
- `templates/head-stencils.provenance.json`: exact master hash, crop rectangle, template/stencil hashes, and used-cell counts. These are generation guides, not output head evidence.
- `raw/`: all original AI outputs, including unselected clearance edits. Selected repairs use the official `sprite:repair` API; unrelated cells stay byte-identical.
- `quality-backlog.json`: deliberately accepted measured soft findings and separate manual visual findings. Hard failures are never accepted here.

Each source sheet has a sibling `*.provenance.json` with the exact prompt, tool, undisclosed model status, UTC recording and references. The class-wide hash index links retained inputs and outputs by file path. Only original project images were used as references; OpenAI Output terms were checked on 2026-11-08. Licence rows live in worker33's own append-only section of `docs/ASSET-LICENSES.md`.

## Reproduction

Run from repository root:

```powershell
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/dao-tu-chibi-v1/prepare-masters.mjs
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/dao-tu-chibi-v1/prepare-motion.ts
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/dao-tu-chibi-v1/E/project.json --out apps/client-cocos/assets/resources/dragonbones/dao-tu-chibi-v1
```

The preparation scripts regenerate masters/guides, not AI motion drawings. They preserve the selected raw sources. `prepare-motion.ts` writes `clip-defaults.json`, not the manually reviewed `project.json` annotations.

For partial authoring diagnostics, `audit-ready.mjs E <system-temp-directory>` runs official gates on available source sheets and writes aligned images only to the supplied temporary directory. Its optional `--accept-note` deliberately records current soft findings through the public backlog API; use only after reviewing those findings. `audit-guides.mjs` checks exact head-stencil coverage in every used/unused cell.

## Motion identity and known visual work

`attack` is the heavy horizontal cut; `attack_2` the arc sweep; `attack_3` the ground strike. `dash` charges forward; `channel` spins the dao; `cast` is the rage roar. Phong remains a proposed element. No gameplay values or runtime/viewer code are changed.

Manual visual findings include weak walk lead-leg reversal, magenta hair spill and shortened-looking low-held blade poses. These remain visible backlog items even when automatic source gates pass. Bone-only Cocos seam metrics cannot prove sprite source continuity; source loop QA remains authoritative. The selected sweep replaces only cells 2/3; the selected hit/dash replaces only source cell 11 (dash local cell 5). Official repair checks preserve every unrelated cell byte-for-byte; `repair-proof.json` records the per-cell and file hashes, reproducible with `verify-repairs.mjs`.

## Validation status

The complete source set passes: 15 clips / 202 drawings, zero hard failures, zero unlisted soft findings and zero regressions. There are 24 accepted walk/run foot-contact findings and five separate manual visual findings. Head evidence and authored origins remain in `project.json` and the exported contract. The compatibility export has two atlas pages and 202 regions; no frames are dropped or resized to fit a page.

Repository checks pass: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run lint`. The actual Cocos 3.8.8 web build and all 15 clips' 2× capture pass (24 midpoint samples per clip). `validation.json` retains the exact capture command, output hashes and result. The source QA also verifies sprite loop seams; Cocos bone-only seam metrics are recorded only as engine diagnostics.

Reproduce the D45 guide hashes in a fresh empty output directory:

```powershell
npm run sprite:layer-template -w @vgtd/sprite -- --project assets-src/placeholder/dao-tu-chibi-v1/E/project.json --out "$env:TEMP/dao-E-layer-guides-final"
```

The generated guides use aligned full-source pixels unchanged. They are removal-edit inputs only; no body-only edit, weapon matte, extraction gate or layered runtime delivery is claimed.

Known baseline exception: `docs/ASSET-LICENSES.md` already fails the repository-wide Prettier check on main. Only worker33's appended section is formatted; unrelated sections are untouched, as directed by the orchestrator.
