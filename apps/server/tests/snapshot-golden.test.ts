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
    expect(stream(r)).toEqual({ checksum: '445b7273', frames: 10333, bytes: 1307332 });
  });

  it('pure world, 150 players packed in 20x20 tiles (over the 120-entity cap: skipped scans, near-band cap, band changes)', () => {
    const r = runTickBench({ players: 150, ticks: 120, warm: 30, area: 20, mobs: 0, combat: false, hash: true });
    expect(stream(r)).toEqual({ checksum: '3ebf2a93', frames: 20983, bytes: 5676093 });
  });

  it('integration: 150 players + 30 mobs with combat (vitals, skill results, hit points on the wire) are unchanged', () => {
    const r = runTickBench({ players: 150, ticks: 120, warm: 30, area: 20, mobs: 30, hash: true });
    expect(stream(r)).toEqual({ checksum: 'b049e8d7', frames: 23508, bytes: 5814930 });
  });

  it('the benchmark itself is deterministic: two runs of the same config give the same checksum', () => {
    const a = runTickBench({ players: 30, ticks: 60, warm: 10, area: 20, mobs: 10, hash: true });
    const b = runTickBench({ players: 30, ticks: 60, warm: 10, area: 20, mobs: 10, hash: true });
    expect(a.checksum).toBe(b.checksum);
    expect(a.checksum).not.toBeNull();
  });
});
