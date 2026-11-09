# Concept references (owner-provided Gemini exports)

Concept art kept as **reference only**. Nothing here is built into the game as a runtime sprite, except the INTERIM mob standees
in `mobs/` (see `docs/ASSET-LICENSES.md`, GEMINI-MOBS).

| Folder        | Content                                                                             | Status                                                            |
| ------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `mobs/`       | 14 mob concepts (`MOB_DEFS[].key`)                                                  | INTERIM standees via `npm run gen:gemini -w @vgtd/procgen`        |
| `npcs/`       | 6 NPC concepts: chuong_mon, su_huynh, tho_ren, thuong_nhan, truong_lao_dan, ve_binh | reference only; NPC standees are built later (worker 42)          |
| `mobs_phase/` | 3 boss phase skins: boss_co_mang p2 / p3, boss_ho_vuong p2                          | reference only; boss phase skin swaps are built later (worker 42) |

Source: AI-generated with Google Gemini by the project owner, 2026-11-09, prompts per the orchestrator prompt pack (part 2 for `npcs/`
and `mobs_phase/`). Files are byte copies (Git LFS) of the owner-provided Gemini exports; magenta background, Gemini mark in the
bottom-right corner. SHA-256 prefixes: `docs/ASSET-LICENSES.md`, section GEMINI-PART2.
