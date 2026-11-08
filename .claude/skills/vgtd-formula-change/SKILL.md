---
name: vgtd-formula-change
description: Change or add a gameplay constant, formula, balance number or JSON data/schema in Vạn Giới Tiên Đồ (stats, breakthrough, Lôi Kiếp, Ngũ hành, linh căn, drop, economy, iso/grid/network constants). Use whenever a number in docs/ or @vgtd/shared must change, or a worked example in docs/07-cong-thuc-data-schema.md is updated. Enforces DECISIONS entry + docs -> @vgtd/shared -> tests -> gen-data.
---

# Formula / constant change

Order matters: docs are the source of truth, code follows. Do not start in code.

## Steps

1. **Locate** the current definition with the `vgtd-spec-lookup` skill. Note which doc owns it
   (`docs/00-ho-so-tong-hop.md` section 3 names the owner in its last column).
2. **Docs first.** Add the `docs/DECISIONS.md` entry (see step 6; entries dated after the docs override docs/00 section 3).
   Then edit `docs/00-ho-so-tong-hop.md` section 3 (superseded old values are recorded only in `docs/DECISIONS.md`) and the owning
   detail doc (most gameplay numbers: `docs/07-cong-thuc-data-schema.md`) with a `[Cập nhật D<n>: ...]` note. Update every worked example whose result changes.
   Keep docs in Vietnamese; mark the change with a short `[Cập nhật ...]` note.
3. **Code in `@vgtd/shared` only** (`packages/shared/src/constants.ts`, `iso.ts`, `formulas/*`). Never edit a copy in another
   package; other packages import from `@vgtd/shared`. If you find a duplicate elsewhere, replace it with an import.
4. **Tests from the worked examples.** Add or update tests in `packages/shared/test/` that reproduce the doc's worked example
   numbers (inputs and printed results from the doc, with the doc's rounding tolerance). Do not fit tests to whatever the code
   outputs. If the doc's own numbers are inconsistent, say so in `docs/OPEN-ITEMS.md` rather than silently picking one.
5. **Regenerate data if JSON or schema changed:**
   ```bash
   npm run gen:data -w @vgtd/shared      # runs packages/shared/scripts/gen-data.mjs
   npx prettier --write packages/shared/src/generated.ts
   ```
   `src/generated.ts` is generated; never hand-edit. A test fails if the committed output is stale.
6. **Log the decision** in `docs/DECISIONS.md`: new row with the next free `D<n>`, old value, new value, deciding doc, and
   which docs were updated. If it resolves an ambiguity, mark it resolved in `docs/OPEN-ITEMS.md`.
7. **Verify from the repo root:** `npm run typecheck && npm test && npm run build && npm run lint && npm run format:check`.
   Grep the repo for the old value to catch leftovers in other packages, `tools/`, and docs.

## Checklist before opening the PR

- Docs, `@vgtd/shared`, tests and DECISIONS entry all changed together.
- No numeric literal for the changed value exists outside `@vgtd/shared`.
- The sim stays deterministic (see `vgtd-sim-determinism`); a formula change that alters server results needs a protocol/data
  version bump if clients depend on it.
