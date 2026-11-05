---
name: vgtd-new-package
description: Create a new npm workspace package (packages/*, apps/*, tools/*) in the Vạn Giới Tiên Đồ monorepo with the correct @vgtd/<name> naming, tsconfig, vitest setup, src/index.ts exports, and root typecheck/test/lint/format wiring. Use when adding any new package or turning a placeholder (apps/server, apps/client-cocos) into a real workspace.
---

# New workspace package

Reference implementations: `packages/shared` (library with generated data) and `packages/client-core` (engine-free client
library). Copy their structure rather than inventing one. Workspaces globs are `packages/*`, `apps/*`, `tools/*`.

## Template

```
<dir>/<name>/
  package.json
  tsconfig.json
  vitest.config.ts
  README.md          # purpose, public API, commands (Vietnamese or English; code comments English)
  src/index.ts       # the only public entry; re-export everything consumers need
  test/*.test.ts
```

`package.json`:

```json
{
  "name": "@vgtd/<name>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "@vgtd/shared": "*" }
}
```

`tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "lib": ["ES2020"], "types": ["node"], "outDir": "dist", "rootDir": "src" }, "include": ["src/**/*.ts"] }`.
If tests must be type-checked, add `tsconfig.test.json` including `src` and `test` (as `packages/shared` does) and point
`typecheck` at it. Add `"DOM"` to `lib` only for client code. Add `noUncheckedIndexedAccess` as `packages/shared` does.

`vitest.config.ts`: `defineConfig({ test: { include: ['test/**/*.test.ts'] } })`.

## Rules

- `typescript`, `vitest`, `eslint`, `prettier` come from the root; do not add them as package devDependencies.
- Depend on `@vgtd/shared` for constants, iso math and formulas; **never redefine them**. Use `"*"` for workspace deps.
- Export from `src/index.ts` only; consumers never deep-import `src/...`.
- Simulation / server packages must follow the `vgtd-sim-determinism` skill.
- Build output (`dist/`) is git-ignored. Do not commit it.

## After creating

```bash
npm install                 # updates package-lock.json workspace entry; commit the lock change
npm run typecheck && npm test && npm run build && npm run lint && npm run format:check
```

Add the package to the monorepo table in `CLAUDE.md` and `AGENTS.md` (keep them identical) and to the root `README.md`.
Confirm the CI `verify` job (Node 18 and 22) is green on the PR.
