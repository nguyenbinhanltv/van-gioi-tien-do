---
name: vgtd-spec-lookup
description: Find the authoritative value or rule for any Vạn Giới Tiên Đồ design question (grid/tile/chunk sizes, layers, quality tiers, budgets, realm stats, breakthrough, Lôi Kiếp, Ngũ hành, drop rates, network numbers, art specs). Use BEFORE writing or changing any number, constant, formula or asset spec, whenever two docs seem to disagree, or when asked "what is the value of X / where is X specified".
---

# Spec lookup

Never answer from memory and never copy numbers into this skill or into code comments. Read the doc, then import the
constant from `@vgtd/shared` (see CLAUDE.md hard rules).

## Order of authority

1. `docs/DECISIONS.md` entries dated after the docs were written (D14 onward) override `docs/00` section 3/4 and every
   doc below, even where the doc text is left verbatim.
2. `docs/00-ho-so-tong-hop.md` section 3 (standard values) and section 4 (superseded decisions); D1-D13 mirror section 4.
3. `@vgtd/shared` source and tests (`packages/shared/src`, `packages/shared/test`).
4. Detail docs below. On conflict with 1-3 they lose.

If a value is not in any of these, it is unspecified: do not invent it. Record the gap in `docs/OPEN-ITEMS.md`.

## Where to look

| Topic                                                                                    | Doc                                |
| ---------------------------------------------------------------------------------------- | ---------------------------------- |
| Overview, merged standard values, superseded decisions, open items                       | `docs/00-ho-so-tong-hop.md`        |
| Core loop, realms, factions, economy (reconstructed GDD)                                 | `docs/01-gdd.md`                   |
| Engine, 2:1 projection, layers L0-L7, Y-sort, bundles, initial-load budget, asset tables | `docs/02-asset-matrix-2d.md`       |
| Spine vs pre-render, paperdoll, canvas sizes, pivot, colliders, bosses                   | `docs/03-nhan-vat-quai-vat.md`     |
| Diamond grid, Wang autotile, cliffs, layers, sample maps                                 | `docs/04-tilemap.md`               |
| Layouts by input mode, 9-slice, icons 48/64/128, quality borders                         | `docs/05-ui-ux-icon.md`            |
| Vạn Kiếm instancing, procedural Lôi Kiếp, shaders, batching, streaming, RAM / MB budgets | `docs/06-toi-uu-render.md`         |
| Stats, breakthrough, Lôi Kiếp, Ngũ hành, linh căn, drop, economy, JSON Schema            | `docs/07-cong-thuc-data-schema.md` |
| AOI, handover, sync, anti-cheat, microservices, protocol                                 | `docs/08-server-architecture.md`   |
| Open questions, unverified work, spec ambiguities                                        | `docs/OPEN-ITEMS.md`               |

## Procedure

1. `Grep` the keyword (Vietnamese term and English term) across `docs/`, starting with `docs/DECISIONS.md`.
2. Check `docs/DECISIONS.md` for a post-doc entry (D14 onward) on the same topic; it wins. Otherwise read the docs/00 section 3 table (it names the originating doc in its last column), then that doc.
3. Find the code form: `Grep` the constant or formula name in `packages/shared/src/` (`constants.ts`, `iso.ts`, `formulas/`).
4. If doc and code disagree, the docs (1-2, with DECISIONS first) win; fix the code via the `vgtd-formula-change` skill.
5. Report the answer with the file and section it came from.
