<!-- Adapted from Claude-Code-Game-Studios (MIT) @05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418 -->

# Checklist: world, level, narrative and character docs

For maps and zones (`docs/04` terms), Động Phủ, quests, NPCs, factions, bosses, lore. Distilled from the upstream level,
narrative and character templates; Vietnamese domain terms stay as written.

## Maps and zones (level design)

- [ ] **Quick reference**: zone id, cảnh giới band, map size in tiles/chunks (shared constants), expected concurrent players, PvP/PvE rules
- [ ] **Layout**: critical path, optional paths, points of interest, safe zone, hub, portals/handover seams; grid is 2:1 isometric, y-down in shared math
- [ ] **Encounters**: spawn tables, density per chunk, respawn timers, boss arenas (multi-tile footprints in `docs/03`), elite/world-boss rules
- [ ] **Pacing chart**: intensity over a typical 5-15 minute visit and a 1 hour session; rest points
- [ ] **Crowding**: what happens at 100 vs 100 (AOI and node-capacity assumptions from `docs/08`), instancing/sharding fallback
- [ ] **Tilemap constraints**: tile size, wall/cliff tiles, Wang sets, Y-sort layers, occlusion needs; no layer or atlas outside `docs/04`/`docs/02`
- [ ] **Streaming**: chunk load order, asset bundle per zone, download-size impact vs the initial package budget
- [ ] **Động Phủ** (private plot): ownership, persistence, visitors, limits
- [ ] **Technical notes**: navigation/pathfinding data, collision, spawn points, server authority over positions

## Narrative, factions, lore

- [ ] **World rules**: the cultivation realms, Ngũ hành relations, linh căn and Lôi Kiếp as named in `docs/00`/`docs/07`; no invented realm names or counts
- [ ] **Factions**: identity, goals, relations (alliance/conflict matrix), territory, join/leave rules, rewards; consistent with the faction list in `docs/01`
- [ ] **Quest structure**: type, prerequisites, steps, rewards (referencing the economy doc, no free-standing numbers), repeat rules, anti-abuse
- [ ] **NPCs and characters**: role, location, voice profile, gameplay function, dialogue state dependencies, topics avoided
- [ ] **Tone and anti-pillars**: matches the stated pillars; flags content that violates them (for example pay-to-win breakthrough fantasy)
- [ ] **Localization**: user-facing strings are keys, Vietnamese primary, space for longer strings in UI (`docs/05`)
- [ ] **Lore consistency**: names, dates, geography and relationships agree across docs; each proper noun spelled one way

## Findings to look for

- A zone or boss that requires a number (HP, level, drop) not owned by `docs/07` / `@vgtd/shared`
- A map larger or denser than the chunk/AOI/draw-call budgets allow
- A quest reward that creates a faucet missing from the economy doc
- Narrative that depends on a client-side-only state (must be server state for an MMO)
- A faction mechanic that makes one faction strictly dominant (no trade-off)
