# @vgtd/character

Engine-agnostic data + logic for characters and monsters (spec: `docs/03-nhan-vat-quai-vat.md`; constants, iso
math and `Direction` come from `@vgtd/shared` and are never redefined here).

| Module          | Contents                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| `direction.ts`  | per-kind direction policy (drawn vs mirrored), `resolveDirection`, mirror rules, direction from movement vector |
| `paperdoll.ts`  | 15 layers, 8-direction Draw Order table, `resolvePaperdoll`, repack ≤ 2 draw-call check                         |
| `animations.ts` | 13 animations (frames / fps / loop / events), Spine event names, playback fps                                   |
| `footprint.ts`  | canvas by footprint, pivot, sockets, overhead UI anchors, collider / hurtbox / pick box                         |
| `boss.ts`       | multi-tile boss, V sort line, part-break, phase-by-skin, mutation variants, rig limits                          |
| `schema.ts`     | JSON Schema (2020-12) for character / monster definition files                                                  |
| `validators.ts` | schema + cross-field validators (`validateCharacterDefinition`, `validateMonsterDefinition`)                    |
| `samples.ts`    | `SAMPLE_PLAYER`, `SAMPLE_BOSS_4X4`                                                                              |

Conventions: socket / UI coordinates are **pivot space, y up** (as printed in the spec); canvas coordinates are
top-left origin, y down (`pivotToCanvas`). Tile `(i, j)` origin is the N vertex (see `@vgtd/shared` iso).
