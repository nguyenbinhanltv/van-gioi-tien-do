# @vgtd/client-world

Engine-agnostic client world logic (pure TypeScript, only dependency `@vgtd/shared`). Conventions: tile `(i, j)` integer = N vertex, centre = `(i+.5, j+.5)`; screen y is **down** in all math here, the Cocos client must flip y.

| Module               | What                                                                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chunk-streaming.ts` | `ChunkStreamer` + pure `computeWantedChunks`/`chunksToEvict`. Priorities visible → ring → ahead (2 s / 3 s flying) → prefetch; ≤ 4 parallel (2 in combat); keep window with centre hysteresis; 30 s hold before unload. |
| `draw-order.ts`      | L0–L7 model: only L3 Y-sorted (`compareDrawOrder` from shared), elevation groups, footprint-bottom-vertex pivots, slicing of footprints > 2 tiles, cliff faces, `buildDrawPlan`, inversion verifier.                    |
| `occlusion.ts`       | Which L3 objects cover the player's pick box (hole-punch flag / 60 % fade for tall objects / X-Ray flag), overhead zone fade (35 %), `FadeAnimator` (0.2 s in, 0.3 s out).                                              |
| `procgen-loader.ts`  | `parseProcgenMap(tileset.json, map.json)` → `ProcgenWorld`; `ProcgenChunkLoader` cuts 32 × 32 chunks; validates format/version/ratio/tile ids.                                                                          |

Stream tiers (`STREAM_TIERS`): `medium` = docs (3×3 load, 5×5 prefetch, 7×7 keep, from `@vgtd/shared`); `low` and `high` are interpretations (low: no ring prefetch, keep 5×5, 2 parallel; high: 5×5 loaded up front).

Notes for the renderer:

- Static objects are biased by ≤ 0.11 px on sortY ties (`staticSortBias`) so entities in front, and larger footprints, win ties; shared's `x` tie-break alone inverts the +j neighbour.
- Cliff faces (`cliffFaceObject`) use the foot-edge pivot `(i+j+1)·16`; keep props one tile away from cliff cells (docs/04 §3).
- Footprints wider than 2 tiles are sliced into `w+h-1` one-column items (`objectDrawItems`); occlusion results are keyed by `sourceId` so all slices fade together.

Scripts: `npm test`, `npm run typecheck`, `npm run build` (the test suite includes a 2,000-sprite sort benchmark that prints timings).
