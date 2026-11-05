---
name: cocos-creator
description: Cocos Creator 3.8.8 conventions for the Vạn Giới Tiên Đồ client (apps/client-cocos) - component patterns, the single y-flip adapter, headless build, editor path env var, how @vgtd/* workspace packages reach Cocos, DragonBones runtime (D35). Use when editing apps/client-cocos or building/running the Cocos client.
---

# Cocos Creator 3.8.8 in this repo

Project: `apps/client-cocos` (2D, TypeScript, Web first). Editor: **3.8.8**, installed at `C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe`. Everything below was verified on that version.

## Golden rules

1. **Single-source shared logic.** Constants, iso math, formulas come from `@vgtd/shared`; input, A\*, anchor layout from `@vgtd/client-core`. Never redefine them in Cocos scripts. Import via `import { shared, core } from './vendor/vgtd.mjs'`.
2. **One y-flip.** `@vgtd/*` uses "logical screen" space (x right, **y down**). Cocos 2D is **y up**. All conversion lives in `assets/scripts/IsoAdapter.ts` (`tileToWorld`, `worldToTile`, `cellCenterToWorld`, `screenToCocos`, `cocosToScreen`, `cameraOffset`; docs/21 §8). `npm run check:yflip -w client-cocos` greps for violations (runs in `typecheck`, so also in CI). Never write `-y` / `y * -1` anywhere else. Anything handed to `shared`/`core` (camera `clientToWorld`, player tile coords) must be in the y-down space.
3. **Do not hand-edit `.meta` UUIDs or scene JSON** unless unavoidable. Let Cocos generate `.meta` (run a headless build once; commit the generated `.meta` for committed assets). The only hand-written assets are `assets/scenes/Bootstrap.scene` (no editor GUI in headless setups; it holds Canvas + Camera + `Bootstrap`) and the engine settings. If you must add a component to the scene by hand, the `__type__` of a user script is its **compressed UUID**: take the script's `.meta` uuid, keep the first 5 hex chars, then encode the remaining 27 hex chars as 9 groups of 3 hex digits, each group -> 2 base64 chars (alphabet `A-Za-z0-9+/`). Prefer building nodes in code instead.
4. **Scenes stay minimal.** One scene (`Bootstrap`) with a `Bootstrap` component on the Canvas; the world is built from code. New features add classes under `assets/scripts/` and are wired in `Bootstrap`.
5. **Layers.** Code-built nodes need `node.layer = Layers.Enum.UI_2D` to be visible to the Canvas camera: use `newNode()` from `IsoAdapter`. World layers follow Asset Matrix: L0 ground, L1 decal, L2 shadow, L3 Y-sort (only this one is sorted), L4 air, L5 weather, L6 world UI, L7 screen UI (HUD node outside the moving world root).

## Component patterns

- `@ccclass('Name') export class X extends Component` with `start`/`update(dt)`; keep game logic in plain classes (no `Component`) and drive them from `Bootstrap.update` so they stay testable and engine-light.
- Camera follow = translate/scale the **world root** under the fixed Canvas camera (`CameraRig`). Round the offset to whole px.
- Y-sort = reorder children of the L3 node with shared `compareDrawOrder` (group, sortY, x, id) via `setSiblingIndex` (`YSortLayer`; keys from `pointSortable`/`footprintSortable`); do not use `UITransform.priority`.
- Batching: put sprites that are drawn together in the same atlas/texture and keep them adjacent in draw order (ground = 1 draw call; L3 sprites + HUD quads share the placeholder atlas). Check the HUD draw-call number after every visual change; budget is **<= 80 draw calls and <= 500 MB on Web** (docs/06).
- Runtime-created textures: `new Texture2D(); tex.image = imageAsset;` then `new SpriteFrame()`, `sf.texture = tex; sf.rect = new Rect(...)`. Assets loaded with `resources.load('world/iso-tileset', ImageAsset)` (load the ImageAsset, not the sub-asset spriteFrame - no importer defaults needed).
- Perf numbers: `director.root.device.numDrawCalls`, `.numTris`, `.memoryStatus.textureSize`; JS heap from `performance.memory` (Chromium only). The `profiler` engine module also paints its own overlay in debug builds; use it as a cross-check.
- Code-generated assets must not be committed: `assets/scripts/vendor/` and `assets/resources/world/` are git-ignored (with their `.meta`).

## How workspace packages reach Cocos (docs/31 I-07, pending confirmation)

Cocos does not resolve npm workspaces for scripts under `assets/`, and ajv (in `@vgtd/shared` validators) needs `new Function`. So:

- `vendor-src/entry.ts` re-exports `shared` (constants, iso, formulas - **not** data/schemas/validators) and `core` (client-core) as namespaces.
- `npm run prepare:assets -w client-cocos` (`scripts/prepare.mjs`) bundles it with esbuild into `assets/scripts/vendor/vgtd.mjs` and writes `vgtd.d.mts` that re-exports types straight from the TS sources (no copied code, always in sync).
- The file must be `.mjs` (a plain `.js` in `assets/` is treated as CommonJS) and imported with the explicit extension: `import { shared } from './vendor/vgtd.mjs'`.
- Need another package/export? Add it to `vendor-src/entry.ts`, re-run prepare. Browser-only or DOM code in client-core is fine (Web first).

## Building headlessly

```bash
npm run build:web -w client-cocos          # prepare:assets + CocosCreator --build -> apps/client-cocos/build/web-mobile
npm run build:web -w client-cocos -- --release
npm run serve -w client-cocos              # static server on http://localhost:7456
npm run typecheck -w client-cocos          # strict tsc against engine typings; skipped if temp/ is missing
```

- Editor path: env `COCOS_CREATOR_PATH` (full path to the executable); defaults to the 3.8.8 install above. Not run in CI (CI has no Cocos); root `typecheck/test/lint/format:check` must keep passing.
- Build options live in `apps/client-cocos/build-config.json` and are passed with `--build "configPath=<file>"`. The inline form `--build "platform=web-mobile;debug=true"` passes strings (`debug` would be ignored with a warning) and does not set a start scene -> "selected scene does not exist". Start scene is `db://assets/scenes/Bootstrap.scene`.
- The CLI exit code is unreliable (0 or 36 even when things fail); `scripts/build-web.mjs` checks that `build/web-mobile/index.html` exists. The first build of a fresh clone takes ~1 min (engine compile cache); later builds ~20-40 s. A harmless `Cannot read properties of undefined (reading 'forEach')` from `sendBuildMetric` is printed at the end.
- Do not leave a shell with its cwd inside `build/` while rebuilding (EBUSY on Windows).
- Headless import generates `library/`, `temp/`, `profiles/`, `local/`, `build/` - all git-ignored. Commit `assets/`, `settings/`, `package.json`, `tsconfig.json`, `*.meta`.

## Verifying in a browser (AO)

`ao preview http://localhost:7456/` (brings the Browser panel forward; screenshots are black if the panel is not painted or the page is still loading - the first frames take 10-15 s with software GL; retake after ~15 s). `ao browser console` keeps only a limited number of messages, so show debug results on the HUD (`PerfHud.note`) instead of relying on late logs. The tool redacts URL query values: use the hash (`#autotest=250,120`) or flags without values. Force a fresh load with `ao browser open about:blank` then the URL.

## Engine settings

`apps/client-cocos/settings/v2/packages/engine.json`: 2D modules only (no physics, tiled-map, video, webview, particle-2d). **DragonBones is the character skeleton runtime (D35, replaces Spine 4.2 of D25):** the target is the built-in `dragon-bones` module, with skeleton data exported as DragonBones JSON 5.5/5.6 (engine reads at most 5.6.300; see docs/art/dragonbones.md). As of this PR the checked-in `engine.json` still has the `spine`/`spine-4.2` modules and not `dragon-bones`; switching the module set is **pending**, owned by the client worker (van-gioi-tien-do-7, DragonBones viewer), not done in the docs PR. Until then do not add new Spine assets (history: D25). Design resolution is set at runtime (`view.setDesignResolutionSize(1280, 720, FIXED_HEIGHT)` from `@vgtd/shared` `DESIGN_WIDTH/HEIGHT`).

## Integration seams (later tasks)

`WorldView` -> client-world chunk streaming (keep `isTerrainWalkable`). `PlayerActor.body` -> paperdoll/DragonBones armature from the character package (Player/Boss: DragonBones 5 directions + mirror, D35; keep `pos`). Register every L3 object through `YSortLayer.add(node, depth)`.
