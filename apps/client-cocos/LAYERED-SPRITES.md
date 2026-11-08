# D45 layered character runtime

`DragonBonesActor.setEquipmentVisuals(folder, mapping, appearance)` uses the browser-safe public character composer and
equipment mapping. Set resources live at `resources/<folder>/<setId>/<setId>_<DIR>.layer.json`, with the manifest's atlas
stems in that same set directory. Cocos imports each `_tex.json`/PNG as a DragonBones atlas asset. Generated atlases must
be premultiplied and match the texture dimensions. Every declared display region must exist.

Only selected body/weapon/FX manifests and atlas pages are requested. The loader namespaces regions, registers every page
under one temporary atlas asset, and composes one armature. Quality tints apply to the neutral FX layer. A null FX mapping
is deliberately unlit. Weapon skins can override their matching FX set; a generated halo naming another weapon is rejected.
Tier aura is exposed through `actor.onEquipmentFx(selection)` for the caller's aura system; no aura artwork is invented.

Call `apply` after changing appearance, as for the existing actor state. Selection/direction loads are generation-guarded:
stale compositions are discarded. A same-motion, same-clip swap keeps the current clock at installation, including the end
of a completed one-shot. Frame actions are suppressed while restoring that pose; hit/cancel events still fire on live
playback. Layered clips own their display indices and z-order; legacy paperdoll edits do not overwrite those timelines.
`clearEquipmentVisuals()` restores the ordinary source path on the next apply. `dispose()` invalidates pending loads and
destroys only manually composed assets; original resources remain Cocos-owned.

Layered equipment requires REALTIME mode. Shared/private animation caches still work on legacy rigs. The viewer selects
REALTIME when equipment changes and reports an error if a layered actor is explicitly switched to a cached mode.

## Viewer and capture

A JsonAsset preview config contains `format: 'vgtd-equipment-preview'`, `version: 1`, `folder`, an inline
`EquipmentVisualMapping`, and an explicit `EquipmentAppearance`. Mapping and appearance types are in
`packages/character/LAYERED-SPRITES.md` and its public exports.

Open `#viewer&equipment=<resource-without-json-extension>&dir=E&mode=single`. Optional hash overrides are `tier`, `quality`,
`costume`, `weapon-skin`, and `hide-costume=1`. The hook `window.__vgtdViewer.setEquipment(patch)` updates the selection;
`equipment()` reports requested/installed sets, pending state, manifest cache count and current slot displays/order.
`events()` returns frame-event history; `events(true)` also clears that test history. `ready()` waits for equipment loads.

```sh
npm run fixture:layers -w client-cocos
npm run build:web -w client-cocos
npm run capture -w client-cocos -- --skip-build --equipment dragonbones/_batch-layer-smoke-27/equipment --layer-smoke --mode single --direction E --animations idle,attack --frames 4 --zoom 2 --out /tmp/layer-smoke
```

The original procedural fixture deliberately uses multiple atlas pages. Smoke assertions cover front/back order, selected
manifest loading, costume hiding, independent weapon/halo selection, quality and aura, preserved swap time, no replayed
events, completed one-shots and superseding selections. Screenshots and `layer-smoke.json` are working QA output.
Fixture resources are git-ignored; no generated output or production art is committed. Legacy captures still use `--src`
and `--stem`. Display-swap seam metrics based on bones alone are zero; sprite source loop QA remains required.
