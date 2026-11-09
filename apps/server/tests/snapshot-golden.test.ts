/**
 * Golden check for the snapshot / AOI hot path: a deterministic world (seeded sim, scripted inputs and casts, virtual packet clock)
 * must send exactly the same bytes as the unoptimised implementation did. The expected values were captured from the code BEFORE the
 * tick-cost optimisation (AOI candidate scan skipped at the cap, one pass for leaves + bands, a per-entity per-tick snapshot cache,
 * chunked BitWriter, reused scratch writers) and the optimised code reproduces them exactly.
 *
 * The first two worlds are PURE (no mobs, no combat): they depend only on the movement sim, the AOI rules and the wire encoder, so they
 * only change when those do. The third includes combat and mobs as an integration check: it will also change when someone changes mob
 * AI, drops or combat results; then re-capture it and say so in the PR. If a PURE golden fails, the wire output changed: either the
 * change is a bug, or it is an intentional AOI / protocol change (re-capture and say so).
 *
 * Re-captured for D82 (class selection): a player's `aoi_enter` record now carries its class wire id in `defId` (was 0). Frame counts and
 * byte totals are unchanged (same field, same width): only the checksums moved.
 *
 * Re-captured for D89 (protocol v5): every frame starts with the version byte, which went 4 -> 5. Frame counts and byte totals are
 * unchanged: only the checksums moved. (The integration world runs with `mobAttacks: false`, so no telegraph frames are in it.)
 */
import { describe, expect, it } from 'vitest';
import { runTickBench } from '../src/loadtest/tick-bench-core.js';

const stream = (r: ReturnType<typeof runTickBench>): { checksum: string | null; frames: number; bytes: number } => ({
  checksum: r.checksum,
  frames: r.frames,
  bytes: r.totalBytes,
});

describe('snapshot stream golden (byte-identical to the pre-optimisation implementation)', () => {
  it('pure world, 60 players: every message of every client is unchanged', () => {
    const r = runTickBench({ players: 60, ticks: 150, warm: 30, area: 30, mobs: 0, combat: false, hash: true });
    expect(stream(r)).toEqual({ checksum: '19ca11d3', frames: 10333, bytes: 1307332 });
  });

  it('pure world, 150 players packed in 20x20 tiles (over the 120-entity cap: skipped scans, near-band cap, band changes)', () => {
    const r = runTickBench({ players: 150, ticks: 120, warm: 30, area: 20, mobs: 0, combat: false, hash: true });
    expect(stream(r)).toEqual({ checksum: 'a4e17b5c', frames: 20983, bytes: 5676093 });
  });

  it('integration: 150 players + 30 mobs with combat (vitals, skill results, hit points on the wire) are unchanged', () => {
    const r = runTickBench({ players: 150, ticks: 120, warm: 30, area: 20, mobs: 30, mobAttacks: false, hash: true });
    // re-captured for D114: the odd packs of a normal mob now carry their variant element, which changes the Ngũ hành multiplier of the
    // fights in this run (the combat outcomes, so frames / bytes move with the checksum); nothing else about the stream changed
    expect(stream(r)).toEqual({ checksum: 'c571a20e', frames: 23274, bytes: 5868356 });
  });

  it('the benchmark itself is deterministic: two runs of the same config give the same checksum', () => {
    const a = runTickBench({ players: 30, ticks: 60, warm: 10, area: 20, mobs: 10, hash: true });
    const b = runTickBench({ players: 30, ticks: 60, warm: 10, area: 20, mobs: 10, hash: true });
    expect(a.checksum).toBe(b.checksum);
    expect(a.checksum).not.toBeNull();
  });
});
