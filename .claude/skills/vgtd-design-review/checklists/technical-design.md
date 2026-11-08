<!-- Adapted from Claude-Code-Game-Studios (MIT) @05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418 -->

# Checklist: technical design docs (docs/20-29) and ADR-style decisions

Distilled from the upstream technical-design and ADR templates. Stack: Cocos Creator 3.8.8 client (TypeScript),
Spine 4.2, TypeScript server on Node (authoritative 20 Hz simulation), shared deterministic code in `@vgtd/shared`.

## Structure

- [ ] **Status block**: draft/proposed/accepted/superseded, date, owner, related decision ids (`DECISIONS.md` D<n>)
- [ ] **Context and requirements**: functional and non-functional (latency, tick budget, bandwidth per client, memory, download size, concurrent players), each traced to a game-design doc or `docs/00` section 3
- [ ] **Architecture**: component diagram, data flow, ownership of state (server vs client), public API/messages, data structures
- [ ] **Decision and alternatives**: at least two real alternatives with reasons for rejection; consequences positive/negative/neutral
- [ ] **Risks and validation**: measurable validation criteria (how will we know it works: benchmark, soak test, 100 vs 100 AOI test)
- [ ] **Implementation plan**: phases, what is prototyped first (open item on step() and World Node)
- [ ] **Testing strategy**: unit, determinism (same input, same output), integration, load; who owns it
- [ ] **Known limitations and future work**
- [ ] **Dependencies** on other docs/packages, bidirectional

## MMO technical checks

- [ ] **Authority**: server validates movement, skills, drops, breakthroughs, trades; client prediction is reconciled, never trusted
- [ ] **Tick and determinism**: fixed 20 Hz from `@vgtd/shared`; no `Math.random`, `Date.now`, `performance.now` in simulation; ordered iteration only (`vgtd-sim-determinism`)
- [ ] **Netcode**: AOI model, snapshot vs delta, priority/relevance, interpolation delay, prediction and reconciliation, lag compensation limits, packet loss/reorder behaviour, reconnect and resume
- [ ] **Protocol**: versioned messages, schema ownership, backward compatibility, size budget per message and per second per client, validation of every field
- [ ] **World partitioning**: chunk size from shared constants, World Node ownership, handover protocol (no dup, no loss), boundary hysteresis
- [ ] **Persistence**: store, write cadence, transaction boundaries, backup/restore, schema migration; the economy ledger is append-only (see `economy-ledger.md`)
- [ ] **Security**: auth, session, rate limits, input validation, anti-cheat signals, secrets handling, privacy of player data
- [ ] **Client architecture**: Cocos component/service structure, Input Abstraction Layer, flip-y at the render boundary, Y-sort, asset bundles, quality tiers, memory and draw-call budgets from `docs/00`/`docs/06`
- [ ] **Web H5 constraints**: initial package budget, WebSocket/WebTransport fallback, main-thread cost, GC pressure, mobile browsers
- [ ] **Observability and ops**: metrics, logs, tracing, alert thresholds, deployment/rollout, config/data hot-reload
- [ ] **Cost/capacity**: nodes per N players, bandwidth per player, DB ops per second; assumptions stated

## Findings to look for

- A constant, formula or iso helper redefined outside `@vgtd/shared` (hard rule in CLAUDE.md)
- A latency/bandwidth/tick claim without a derivation from the budgets
- A requirement in a game-design doc with no technical answer (traceability gap) or the reverse (technical feature nobody asked for)
- Two technical docs disagreeing on ownership of the same state or message
- Engine API assumed without checking Cocos Creator 3.8.8 or Spine 4.2 (mark UNVERIFIED instead of asserting)
