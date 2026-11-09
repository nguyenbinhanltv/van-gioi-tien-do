# @vgtd/econ-sim

Deterministic offline economy simulator (D113, docs/26 section 8 M0-M1). Replays a cohort of simulated players over 30-90 days with the
real `@vgtd/shared` formulas and tables and reports stone supply per player per day, the sink / faucet ratio, time to realm, and flags
for dominant loops and runaway faucets. **It reports; it never changes a gameplay number** (changes go through `vgtd-formula-change`).

```bash
npm run sim -w @vgtd/econ-sim -- --out ../../docs/35-mo-phong-kinh-te.md   # full report (~40 s), then: npx prettier --write docs/35-mo-phong-kinh-te.md
npm run sim -w @vgtd/econ-sim -- --quick                                   # 400 players, 42 days, to stdout
npm test -w @vgtd/econ-sim
```

- `src/params.ts`: every behaviour parameter and the list of `ASSUMPTIONS` (numbers the docs leave open; all need a designer).
- `src/sim.ts`: the cohort day loop, the ledger (faucet / sink channels), the market. Money is conserved (tested).
- `src/analyze.ts`: weekly ratios, channel shares, pacing, flags, and the bisection for the repair multiplier that reaches 0.9.
- `src/report.ts`: the Vietnamese Markdown report with text bar charts.
- Deterministic: the PRNG is `rngSeed` of `@vgtd/shared`; the same params and seed give the same bytes.

Change a table in `@vgtd/shared` (or an assumption) and regenerate the report; the committed report is one run with seed 1.
