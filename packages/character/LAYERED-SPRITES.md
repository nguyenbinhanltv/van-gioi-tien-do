# Layered sprite appearance (D45)

The public `@vgtd/character` exports include the browser-safe `SpriteLayerSet` model, validation, `composeSpriteLayers`,
`namespaceSpriteLayerAtlas`, lazy `SpriteLayerCache`, and equipment visual mapping/resolution. Existing exports are unchanged.

A layer manifest carries role, identity, shared T1 motionId, direction, canvas/pivot, texture resource stems, display geometry,
and clips on `SPINE_KEY_FPS` integer ticks. Every weapon frame declares front/back order. Body/weapon/optional FX must match
motion, direction, canvas, frame ticks, loop and event anchors. Composition emits one DragonBones5.5 armature, per-slot
stepped display swaps, per-frame z-order and a single body-owned event timeline. FX is additive and accepts runtime tint.
Atlas regions must be namespaced per set before registering the pages under one texture group; input data is never mutated.

Equipment mapping declares T1–T5 body/weapon/fx/aura set IDs, independent costume body and weapon-skin overrides, plus all
six shared quality IDs' normalized RGBA glow tints. `hideCostume` affects the body override only. Appearance resolution
contains no shop, ownership, pricing or combat logic. Content supplies canonical quality colours; no palette is duplicated here.

`SpriteLayerCache` loads only requested set/direction pairs, deduplicates in-flight work, permits retry after failure, and
supports eviction/clear. The runtime adapter must reject stale asynchronous selections before installing a composition.

The composer is tested with synthetic manifests and, when Cocos Creator3.8.8 is installed, the real DragonBones parser.
This model does not extract weapons, paint hands, load Cocos textures or render aura/glow by itself. See
`docs/art/sprite-sheet-pipeline.md` and subsequent tooling/runtime changes for those stages.
