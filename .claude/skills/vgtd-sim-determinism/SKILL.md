---
name: vgtd-sim-determinism
description: Rules for deterministic game simulation and network protocol code in Vạn Giới Tiên Đồ (authoritative World Node, shared step(), client prediction, combat/loot/breakthrough rolls). Use when writing or reviewing any server, shared-sim or prediction code, adding randomness, time, map/set iteration, or message formats, and when adding same-input-same-output tests.
---

# Simulation determinism

Server and client prediction must produce identical results from identical inputs. Specs: `docs/08-server-architecture.md`
(tick, input ordering, reconciliation, anti-cheat) and `docs/07-cong-thuc-data-schema.md` (rolls, logging). Read them; do not
copy their numbers here or into code, import from `@vgtd/shared` (for example the tick constants in `NETWORK`).

## Rules

1. **No ambient nondeterminism in sim code:** never call `Math.random`, `Date.now`, `new Date()`, `performance.now`,
   `crypto.randomUUID`, or read wall-clock/timezone/locale. Time is the **tick number**; durations are tick counts derived
   from `@vgtd/shared` constants. Wall clock is allowed only at the edges (network, logging, scheduling the tick loop).
2. **Seeded RNG only.** All randomness (damage variance, crit, drop, breakthrough, tribulation) comes from a seeded PRNG
   instance passed into the step/formula (shared formulas already take injected random values). The PRNG must live in
   `@vgtd/shared` so client and server run the same algorithm. It does not exist yet: add it there (docs + tests per
   `vgtd-formula-change`) and note the gap in `docs/OPEN-ITEMS.md` if you hit it; never write a private copy in a package.
   Draw order is part of the contract: consume random numbers in a fixed, documented order; never draw conditionally on
   something that differs between client and server. Server logs seed and each roll for dispute review (`docs/07` section 2).
3. **Fixed tick:** one authoritative step per tick at the shared tick rate; `step(state, inputs, tick)` is a pure function of
   its arguments. No variable `dt`, no `setTimeout`-based logic inside the step. Catch-up runs whole ticks.
4. **Numeric rules.** Prefer integers (milli-units / fixed-point) for state that must match exactly: HP, MP, cooldown ticks,
   currency, item counts. Where floats are needed (positions in tile units), use only `+ - * /` and `Math.floor/ceil/round/
abs/min/max/sqrt` in a fixed evaluation order; avoid `Math.sin/cos/pow/exp/log` and `**` in state-affecting paths unless
   the result is quantized before it enters state, since engines may differ in the last bit. Quantize/round at defined
   points (document where). Never compare floats for equality across client and server; reconcile with a tolerance.
5. **No unordered iteration for gameplay.** Do not rely on `Map`/`Set`/object key order for anything that affects outcome
   (damage application, target selection, loot, AOI broadcast). Iterate sorted by a stable key (entity id) or use arrays /
   id-indexed dense arrays. Ties are broken explicitly (compare id last, as `compareDrawOrder` does for sorting).
   `Array.prototype.sort` callbacks must be total orders.
6. **Inputs are intents, ordered by sequence number** (`docs/08` section 8); the client never sends positions or results.
   Apply inputs in `seq` order; wrap-around of the 16-bit counter must be handled. Reject stale/duplicate sequence numbers.
7. **Protocol versioning.** Every wire format has an explicit version in the handshake and in persisted snapshots/replays.
   Changing field layout, enum values, formula behaviour or data tables that alter results bumps the version; the Gateway
   refuses incompatible clients with a clear error. Unknown optional fields are skipped, unknown required ones reject.
   Keep codecs in one shared module; client and server never hand-roll separate serializers.
8. **Server authority.** Cooldowns, damage, position and economy are decided server-side; prediction is only a guess that
   reconciliation corrects. Economy changes go through the double-entry ledger path, never through sim state alone.

## Tests (required for any sim change)

- **Same input, same output:** run the step N ticks twice from identical state + seeded RNG + input list and assert
  deep-equal final state and identical event log. Use a fixed seed constant in the test file.
- **Different seed, different output** (guards against an RNG that is silently ignored).
- **Order independence:** shuffle insertion order of entities/inputs that must not matter and assert identical results;
  conversely assert `seq` order does matter.
- **Replay/golden test:** record a short input script plus expected state hash and keep it versioned; changing it needs a
  version bump and a `docs/DECISIONS.md` entry.
- **Client/server parity:** run the shared step in both prediction and authoritative setups on the same inputs.
- Add a lint/grep check (test or script) that sim directories contain none of: `Math.random`, `Date.now`, `new Date`,
  `performance.now`.

## Review checklist

No ambient time/random; RNG injected and draw order fixed; integers for exact state; no Map-order dependence; ids as tie
breakers; version bumped when behaviour or wire format changed; tests above present; constants imported from `@vgtd/shared`.
