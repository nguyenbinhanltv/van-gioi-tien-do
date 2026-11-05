# @vgtd/sim

Pure, deterministic simulation shared by client prediction and the server World Node (docs/08 §4–6).

- `step(world, inputs, { grid, skills }, dtMs = 50)` → `{ world, events }` — fixed 20 Hz tick; never mutates its arguments.
- `stepMove(moveState, { dtMs, dir, mag, flags }, grid)` — the movement rule alone (what the client predicts with).
- `TileGrid` / `CollisionGrid` — walkability + elevation grid. Tile `(ti, tj)` covers `[ti, ti+1) × [tj, tj+1)` in `(i, j)` space
  (integer `(i, j)` = N vertex, see `@vgtd/shared` iso math); the collider is a circle of `COLLIDER_RADIUS_TILES` (0.35).
- Axis-separated movement in ≤ 0.5-tile sub-steps (no tunnelling), flush-to-wall bisection, tangent slide for exact-diagonal corner hits.
- Anti-cheat: declared-time budget `1.02·(t−t₀)+250 ms` with sliding reset, per-tick input allowance (1.25×), dt clamp 8–50 ms,
  suspicion score (warn 20 / disconnect 50, −1/min), 60 s claimed/real ratio windows, server-held cooldowns (`readyAt − min(RTT/2, 100 ms)`),
  GCD, MP, range, line of sight, and a 10/s cast token bucket.
- `stateHash(world)` — canonical 64-bit hash over all gameplay fields (determinism tests, desync detection).

Determinism rules: no `Math.random` / `Date.now`; only `+ − × ÷` and `sqrt` (a Taylor-series table replaces `sin`/`cos`); entities are
iterated in ascending id; `Map`s are lookup-only; randomness comes from the seeded RNG stored in the world (`rng`).
Everything shared with the rest of the game (tick rate, collider radius, stats) is imported from `@vgtd/shared`.
