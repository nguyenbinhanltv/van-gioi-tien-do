<!-- Adapted from Claude-Code-Game-Studios (MIT) @05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418 -->

# Checklist: economy and balance doc (server-authoritative ledger)

For drops, currencies, crafting, market, and sink/faucet design. Distilled from the upstream economy-model template and
adapted for a persistent MMO where duplication or inflation is permanent damage.

## Structure

- [ ] **Currency list**: each currency/resource with id, tier, bind rules (account/character/unbound), cap, decay
- [ ] **Faucets** (sources): every source with rate per hour at each cảnh giới, gating, and the `docs/07` formula or drop table it comes from
- [ ] **Sinks**: every sink with cost curve; at least one sink that scales with wealth for each faucet that scales with power
- [ ] **Balance targets**: expected net flow per cảnh giới band and per hour of play; healthy ratio of faucet to sink stated
- [ ] **Progression curves**: realm stat/exp requirements and item price scaling continuous with `docs/07` (no cliff at realm boundaries)
- [ ] **Loot tables**: weights, pity/guarantee rules, per-source tables; probabilities sum correctly; pity state is persisted
- [ ] **Quality ladder**: the quality tier count and names come from `docs/00` section 3 / `DECISIONS.md` (D6: six tiers, not five)
- [ ] **Health metrics**: inflation indicator, Gini or wealth-share, time-to-next-realm, median currency balance, dupe alerts
- [ ] **Ethical guardrails**: spend limits, odds disclosure, no pay-to-win breakthrough; matches any monetization decision in `docs/DECISIONS.md`

## Ledger integrity (server)

- [ ] Every currency/item mutation is a ledger entry: id, actor, delta, reason code, tick, idempotency key, resulting balance
- [ ] Transactions are atomic and idempotent; a replayed or reordered request cannot apply twice
- [ ] Trades/market: two-phase commit or escrow; both sides validated against the same ledger version
- [ ] Reconciliation: periodic invariant check (sum of faucets minus sinks equals total supply) and an alarm when it drifts
- [ ] Rollback and compensation path after a crash, handover or exploit; GM/admin adjustments are ledger entries too
- [ ] Rate limits and anomaly flags on high-volume actors (botting, RMT, duplication)
- [ ] Rolls for drops/breakthroughs use the seeded deterministic RNG; the roll inputs are logged so a dispute can be replayed

## Findings to look for

- Faucet without sink, sink without faucet, faucet that scales with power with a flat sink (inflation)
- Positive feedback loops (wealth makes more wealth) without a catch-up or cap
- Drop rate or price that disagrees with `docs/07` / `@vgtd/shared`; probabilities that do not sum to the stated total
- A currency that crosses account or server boundaries without a defined migration rule
- No simulation plan: `docs/OPEN-ITEMS.md` should list the economy simulation before closed beta (do not claim balance without it)
