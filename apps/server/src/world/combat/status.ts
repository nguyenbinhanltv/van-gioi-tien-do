/**
 * Status effects on players (D91): root, slow, poison damage over time and ground poison pools, applied by mob attacks (elite / boss
 * skills). Server-authoritative and deterministic: no clocks (every time is sim ms passed in), no randomness (damage per tick is fixed
 * when the effect is applied), iteration by ascending entity id / insertion order, `digest()` for the replay tests.
 *
 * Movement effects change the player's INPUT before the sim step (`adjustMove`): a rooted player's magnitude is zeroed, a slowed
 * player's magnitude is scaled. The client does not know about them (no status on the wire yet, OPEN-ITEMS), so its prediction runs
 * at full speed and is pulled back by the normal reconciliation: a rooted / slowed player rubber-bands instead of seeing a clean
 * effect. Damage over time and pools are plain damage events and show up through the own-vitals block like any other damage.
 */
import type { MoveInput } from '@vgtd/sim';
import { hypot } from '@vgtd/sim';

export interface DotHit {
  targetId: number;
  amount: number;
  sourceId: number;
}

interface Slow {
  untilMs: number;
  factor: number;
}
interface Poison {
  untilMs: number;
  tickMs: number;
  nextMs: number;
  amount: number;
  sourceId: number;
}
interface Pool {
  i: number;
  j: number;
  radius: number;
  untilMs: number;
  tickMs: number;
  nextMs: number;
  amount: number;
  sourceId: number;
}

export class StatusSystem {
  private readonly rootUntil = new Map<number, number>();
  private readonly slows = new Map<number, Slow>();
  private readonly poisons = new Map<number, Poison>();
  private pools: Pool[] = [];

  rootPlayer(id: number, nowMs: number, ms: number): void {
    this.rootUntil.set(id, Math.max(this.rootUntil.get(id) ?? 0, nowMs + ms));
  }

  /** The stronger slow wins (lower factor); the longer duration wins. */
  slowPlayer(id: number, nowMs: number, ms: number, factor: number): void {
    const cur = this.slows.get(id);
    const f = Math.min(Math.max(factor, 0), 1);
    if (cur && cur.untilMs > nowMs)
      this.slows.set(id, { untilMs: Math.max(cur.untilMs, nowMs + ms), factor: Math.min(cur.factor, f) });
    else this.slows.set(id, { untilMs: nowMs + ms, factor: f });
  }

  /** Re-applying refreshes the duration and keeps the stronger tick damage; the tick clock is not restarted. */
  poisonPlayer(id: number, nowMs: number, ms: number, tickMs: number, amount: number, sourceId: number): void {
    const cur = this.poisons.get(id);
    if (cur && cur.untilMs > nowMs)
      this.poisons.set(id, {
        ...cur,
        untilMs: Math.max(cur.untilMs, nowMs + ms),
        amount: Math.max(cur.amount, amount),
        sourceId,
      });
    else this.poisons.set(id, { untilMs: nowMs + ms, tickMs, nextMs: nowMs + tickMs, amount, sourceId });
  }

  addPool(
    p: { i: number; j: number; radius: number; ms: number; tickMs: number; amount: number; sourceId: number },
    nowMs: number,
  ): void {
    this.pools.push({
      i: p.i,
      j: p.j,
      radius: p.radius,
      untilMs: nowMs + p.ms,
      tickMs: p.tickMs,
      nextMs: nowMs + p.tickMs,
      amount: p.amount,
      sourceId: p.sourceId,
    });
  }

  isRooted(id: number, nowMs: number): boolean {
    return (this.rootUntil.get(id) ?? 0) > nowMs;
  }
  slowFactor(id: number, nowMs: number): number {
    const s = this.slows.get(id);
    return s && s.untilMs > nowMs ? s.factor : 1;
  }
  isPoisoned(id: number, nowMs: number): boolean {
    return (this.poisons.get(id)?.untilMs ?? 0) > nowMs;
  }
  get poolCount(): number {
    return this.pools.length;
  }

  /** The movement input after root / slow: rooted = magnitude 0 (kept, not dropped, so the sim's time accounting is unchanged). */
  adjustMove(inp: MoveInput, nowMs: number): MoveInput {
    if (this.isRooted(inp.entityId, nowMs)) return inp.mag === 0 ? inp : { ...inp, mag: 0 };
    const f = this.slowFactor(inp.entityId, nowMs);
    return f >= 1 ? inp : { ...inp, mag: Math.floor(inp.mag * f) };
  }

  /** Forget everything about a player (left, died, respawned). */
  clear(id: number): void {
    this.rootUntil.delete(id);
    this.slows.delete(id);
    this.poisons.delete(id);
  }

  /**
   * Advance to `nowMs`: the due poison ticks and pool ticks, victims in ascending id order. `players` lists the living player positions
   * (ascending id). Expired effects are dropped.
   */
  tick(nowMs: number, players: ReadonlyArray<{ id: number; i: number; j: number }>): DotHit[] {
    const out: DotHit[] = [];
    for (const [id, p] of [...this.poisons].sort((a, b) => a[0] - b[0])) {
      if (!players.some((x) => x.id === id)) {
        this.poisons.delete(id);
        continue;
      }
      while (p.nextMs <= nowMs && p.nextMs <= p.untilMs) {
        out.push({ targetId: id, amount: p.amount, sourceId: p.sourceId });
        p.nextMs += p.tickMs;
      }
      if (p.untilMs <= nowMs) this.poisons.delete(id);
    }
    for (const pool of this.pools) {
      while (pool.nextMs <= nowMs && pool.nextMs <= pool.untilMs) {
        for (const pl of players) {
          if (hypot(pl.i - pool.i, pl.j - pool.j) <= pool.radius)
            out.push({ targetId: pl.id, amount: pool.amount, sourceId: pool.sourceId });
        }
        pool.nextMs += pool.tickMs;
      }
    }
    this.pools = this.pools.filter((p) => p.untilMs > nowMs);
    for (const [id, t] of this.rootUntil) if (t <= nowMs) this.rootUntil.delete(id);
    for (const [id, s] of this.slows) if (s.untilMs <= nowMs) this.slows.delete(id);
    return out;
  }

  digest(): string {
    const sorted = <T>(m: Map<number, T>): Array<[number, T]> => [...m].sort((a, b) => a[0] - b[0]);
    return JSON.stringify({
      root: sorted(this.rootUntil),
      slow: sorted(this.slows),
      poison: sorted(this.poisons),
      pools: this.pools,
    });
  }
}
