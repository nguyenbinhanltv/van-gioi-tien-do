<!-- Adapted from Claude-Code-Game-Studios (MIT) @05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418 -->

# Checklist: game-design doc completeness

Distilled from the upstream GDD template (sections) for a Vietnamese MMO design doc. Headings may be Vietnamese
(for example "Tổng quan", "Quy tắc", "Công thức", "Trường hợp biên", "Phụ thuộc", "Tham số điều chỉnh",
"Tiêu chí chấp nhận"); judge by content, not by heading text. Mark each item PRESENT / THIN / ABSENT with a line number.
A heading that holds only a placeholder counts as ABSENT.

## Required (missing = Major)

- [ ] **Overview**: one paragraph, what the system is and why it exists; names the pillar or the core-loop stage it serves
- [ ] **Player fantasy**: the intended feeling in tu tiên terms (cultivation, breakthrough tension, rivalry, community)
- [ ] **Detailed rules**: unambiguous mechanics; states and transitions; who initiates, who validates (server), what the client may only predict
- [ ] **Formulas**: every number defined with variables, units, ranges and a worked example; values come from `docs/00` section 3 / `docs/07` / `@vgtd/shared`, never restated differently
- [ ] **Edge cases**: death, disconnect, handover between World Nodes, lag spikes, duplicate or replayed requests, full inventory, simultaneous actions, rollback
- [ ] **Dependencies**: systems it uses and systems that use it, bidirectional with the other doc's list; each link names a section that exists
- [ ] **Tuning knobs**: which values are data-driven, their safe ranges, the owner doc, and which constant in `@vgtd/shared` holds them
- [ ] **Acceptance criteria**: each independently testable and measurable ("breakthrough success rate over N trials is within X of formula", not "feels balanced")

## Advisory (missing = Minor)

- [ ] **UI requirements**: HUD/panel per input mode (touch, mouse+keyboard, gamepad), links to `docs/05`
- [ ] **Visual/audio requirements**: asset needs in `docs/02` terms (atlas, Spine 4.2 animations, VFX flipbooks), within `docs/00` section 3 budgets
- [ ] **Game feel**: timings, telegraphs, hit-stop (Lôi Kiếp telegraph, skill wind-up) as numbers where they affect netcode or balance
- [ ] **Cross-references table**: target doc, element referenced, nature of dependency
- [ ] **Open questions**: anything undecided is listed here AND in `docs/OPEN-ITEMS.md`, not silently assumed

## MMO-specific (missing = Major unless the doc says N/A with a reason)

- [ ] **Authority**: every state change is validated server-side; no client-trusted values
- [ ] **Scale**: expected concurrent players per map/instance, per-system load, and what happens above that
- [ ] **Persistence**: what is saved, when, and the recovery path after a crash or rollback
- [ ] **Cheating and abuse**: duplication, botting, RMT, scripting, exploit-by-latency; mitigation or an explicit risk note
- [ ] **Determinism**: any roll uses the seeded RNG and the fixed 20 Hz tick (`vgtd-sim-determinism`); no wall-clock time
- [ ] **Cross-play**: behaves the same on Web H5, mobile and PC (input differences are in client layout, not rules)
- [ ] **Live-ops**: values changeable by data without a client patch; versioning of the data schema

## Implementability smells (each is a finding)

- "TBD", "to be balanced", "similar to X", "etc.", unresolved options presented as a rule
- A rule that needs a value the docs do not specify (add to `docs/OPEN-ITEMS.md`, do not invent)
- A number that exists in two places in the doc with different values
- A formula whose output range feeds a downstream formula with an incompatible input range
- A system that requires a client-authoritative decision, or a decision that is time-dependent but not tick-based
