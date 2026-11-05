# @vgtd/shared

Pure TypeScript shared by client (Cocos Creator) and server. Only runtime dependency: `ajv` (used by `validators.ts`).

| Area | Module | Source of truth |
|---|---|---|
| Constants (grid 64×32, chunk 32×32, L0–L7, 8 directions, 6 quality tiers, 20 Hz / 10 Hz, AOI, budgets) | `src/constants.ts` | Hồ sơ tổng hợp §3 |
| Iso math (tile↔screen, chunk index, AOI hash, Y-sort keys) | `src/iso.ts` | Asset Matrix, Tilemap, Nhân vật docs |
| Formulas (stats, breakthrough, Lôi Kiếp, Ngũ hành + damage, linh căn, drops, market/teleport/durability) | `src/formulas/*.ts` | Công thức & Data Schema (+ Hồ sơ §4 where they conflict) |
| JSON Schemas / sample data + validators | `src/schemas`, `src/data`, `src/validators.ts` | Công thức §8–9 |

`src/generated.ts` is generated from `src/data/*.json` and `src/schemas/*.json` (`npm run gen:data`) so there is no JSON-import dependency at runtime; a test fails if it is stale.

Scripts: `npm run build` · `npm test` · `npm run typecheck`.

Conventions: Node ≥ 18, ESM (`NodeNext`, relative imports end in `.js`), strict TS. Projection: `x = (i − j)·32`, `y = (i + j)·16` (px @1x, y down); integer `(i, j)` is the **N vertex** of tile `(i, j)`, tile centre is `(i + .5, j + .5)`.
