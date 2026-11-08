# Vạn Giới Tiên Đồ – agent guide

2D isometric cultivation (tu tiên) MMORPG. Client: Cocos Creator 3.x (TypeScript). Server MVP: TypeScript on Node.
Platforms: Web H5 + Mobile + PC, cross-play. This file is mirrored in `AGENTS.md` (Codex / Antigravity); keep both identical.

## Monorepo map and ownership

npm workspaces (`packages/*`, `apps/*`, `tools/*`), Node >= 18, TypeScript strict, vitest.

| Path                        | Package                     | Purpose                                                                                                                                                      |
| --------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared`           | `@vgtd/shared`              | Constants, iso math, gameplay formulas, JSON schemas + sample data                                                                                           |
| `packages/client-core`      | `@vgtd/client-core`         | Input Abstraction Layer, pathfinding, responsive HUD layout (engine-free)                                                                                    |
| `packages/client-world`     | `@vgtd/client-world`        | Chunk streaming, L0-L7 draw order, occlusion, procgen map loader (engine-free)                                                                               |
| `packages/character`        | `@vgtd/character`           | Direction model, paperdoll, animation table, footprint/sockets/hitboxes, boss descriptors, definition schemas (engine-free)                                  |
| `apps/server`               | (placeholder)               | Server MVP, authoritative 20 Hz simulation                                                                                                                   |
| `apps/client-cocos`         | (placeholder)               | Cocos Creator project; flips y when rendering shared iso math                                                                                                |
| `tools/procgen`             | `@vgtd/procgen`             | Asset generation, QA, atlas packing, compression pipeline                                                                                                    |
| `tools/rig`                 | `@vgtd/rig`                 | AI animation authoring: rig schema, animation DSL, DragonBones exporter, automated animation QA (D35/D36)                                                    |
| `tools/dragonbones-testrig` | `@vgtd/dragonbones-testrig` | Generates the minimal DragonBones 5.5 test rig used by the Cocos animation viewer (independent of `tools/rig`)                                               |
| `tools/sprite`              | `@vgtd/sprite`              | Frame-by-frame AI sprite-sheet pipeline for Player bodies (D41): template, slicer, aligner, palette lock, atlas, DragonBones display-swap exporter, QA gates |
| `docs/`                     | -                           | Design specs (Vietnamese), decision log, open items                                                                                                          |
| `.claude/`, `CLAUDE.md`     | -                           | Agent config and project skills                                                                                                                              |

Each package owns its own directory. Do not edit another package's files without coordinating through the orchestrator
session; cross-package needs go through the public `src/index.ts` export.

## Source of truth (highest first)

1. `docs/DECISIONS.md` entries dated after the docs were written (D14 onward) override `docs/00` section 3/4 and every
   doc below, even where the doc text is left verbatim.
2. `docs/00-ho-so-tong-hop.md` section 3 (standard values) and section 4 (superseded decisions); D1-D13 mirror section 4.
3. `@vgtd/shared` (executable form of 1-2; tests reproduce the worked examples in `docs/07-cong-thuc-data-schema.md`).
4. The other docs (`docs/01`..`docs/08`) for detail. If they conflict with 1-3, they lose.

Changing a value: add the `docs/DECISIONS.md` entry first (it takes effect immediately), then `@vgtd/shared` and tests,
then update docs/00 section 3 and the detail doc with a `[Cập nhật D<n>: ...]` note; until the docs are updated the
DECISIONS entry wins. Use the
`vgtd-formula-change` skill. Use `vgtd-spec-lookup` to find where a value is specified.

## Hard rules

- **Never redefine constants, formulas or iso helpers outside `@vgtd/shared`.** Import them (`import { ... } from '@vgtd/shared'`).
  No literal copies of tile size, chunk size, tick rate, quality tiers, element multipliers, budgets, etc. in other packages.
- Shared math is y-down screen space. Integer tile `(i, j)` is the N vertex; the tile centre is `(i + 0.5, j + 0.5)`.
  The Cocos client must flip y at the rendering boundary.
- Simulation code is deterministic: no `Math.random`, `Date.now`, `performance.now`; fixed 20 Hz tick (skill `vgtd-sim-determinism`).
- Third-party or MCP-sourced assets require a license check before use (skill `vgtd-asset-pipeline`).
- Gameplay defaults decided without a designer (D16-D22 etc.) are marked "cần game designer duyệt khi cân bằng": implement
  them as specified, but do not treat them as final balance.
- Character animation: Player bodies are AI sprite sheets frame by frame exported as one DragonBones display-swap armature (D41, amends D36/D39/D40; pipeline `@vgtd/sprite`, `docs/art/sprite-sheet-pipeline.md`); skeletal rigs (D35 DragonBones, `@vgtd/rig`) remain for bosses/NPCs; MVP auth is username/password, Google SSO later (D26); hosting is local-only for now (D27).
- Do not create or edit `.claude/settings.json` (D30): agent permission self-edits are blocked on purpose.
- Prefer the latest locked decisions in `docs/DECISIONS.md` over memory or older docs. Do not invent gameplay values that
  the docs do not specify; add the gap to `docs/OPEN-ITEMS.md` instead.

## Verify (run from the repo root; all must pass before pushing)

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run lint
npm run format:check      # `npm run format` to fix
```

CI is GitHub Actions only (`.github/workflows/ci.yml`, job `verify`, Node 18 and 22): ci, typecheck, test, build and lint.
Keep it short; there is no CD. `main` has branch protection requiring `verify (18)` and `verify (22)`: wait for both to be
green on your PR and never bypass it. Generated data: `npm run gen:data -w @vgtd/shared` after editing schema JSON.

## Git rules

- Branch from the latest `origin/main`: `git fetch && git switch -c <branch> origin/main`. Never commit to `main`.
- Sync with **merge** (`git merge origin/main`). **Never rebase. Never force-push** (no `--force`, `-f`, `--force-with-lease`).
- Never `git reset --hard`. Conventional commits (`feat(shared): ...`, `docs: ...`). One PR per scoped task; do not merge your own PR.
- Branch names stay inside the session namespace given by the orchestrator (for example `ao/<session>/<topic>`).
- Do not commit generated output (`out/`, `build/`, `dist/`) or secrets. `.claude/settings.local.json` is local-only.

## Language

- Docs under `docs/`: Vietnamese (keep headings, tables, formulas; mark overrides with `[Cập nhật ...]` notes).
- Code, identifiers, comments, commit messages, PR text, this file: English. Vietnamese domain terms (Linh Căn, Lôi Kiếp, ...)
  stay as-is in identifiers' doc comments and user-facing strings.

## Where things go

- Open questions, ambiguities, unverified work, missing design areas: `docs/OPEN-ITEMS.md`.
- Locked decisions and superseded values: `docs/DECISIONS.md` (new row per decision, next free `D<n>`).
- Package conventions: name `@vgtd/<name>`, `tsconfig.json` extends `../../tsconfig.base.json`, scripts `build` / `test` /
  `typecheck`, `exports` -> `src/index.ts` (skill `vgtd-new-package`).

## Project skills (`.claude/skills/`)

| Skill                  | Use when                                                                     |
| ---------------------- | ---------------------------------------------------------------------------- |
| `vgtd-spec-lookup`     | Need the authoritative value or rule for anything in the design              |
| `vgtd-formula-change`  | Changing a constant, formula or data schema                                  |
| `vgtd-new-package`     | Creating a new workspace package                                             |
| `vgtd-sim-determinism` | Writing or reviewing server / shared simulation code or the network protocol |
| `vgtd-asset-pipeline`  | Generating, packing, compressing or importing assets                         |

## Autonomous operation (24/7)

Rules for continuous work until the MVP is done (queue, decision gates, who decides what, merge conditions, limits, emergency stop): `docs/30-quy-tac-van-hanh.md`. Short version: never decide items listed there under "Phải hỏi người"; max 6 parallel workers (D38; the orchestrator closes finished worker sessions each cycle); the orchestrator may merge a PR only when `verify (18)` and `verify (22)` are green and the conditions in section 6.4 hold.

## Design review

Review skills (read-only, output a Markdown findings report with `file:line` and severity; adapted from
Claude-Code-Game-Studios, see `THIRD_PARTY_NOTICES.md`): `vgtd-design-review` (one doc, with checklists),
`vgtd-review-all-gdds` (cross-doc), `vgtd-propagate-design-change` (impact of a changed value or rule),
`vgtd-architecture-review` (design to technical docs 20-29). Specialist subagents in `.claude/agents/`: game-designer,
systems-designer, economy-designer, narrative-director, level-designer, network-programmer, security-engineer, qa-lead,
technical-director, creative-director.
