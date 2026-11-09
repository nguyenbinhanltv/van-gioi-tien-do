/**
 * Skill effect state of the combat core (D116): everything a cast leaves behind after its instant damage / heal / shield.
 *
 *   on players: timed buffs (`buff`: dmg_pct, crit_chance, lifesteal, dr_pct, def_pct, ...), heal-over-time zones (`hot`), the pet of a
 *               passive `summon`;
 *   on mobs:    control (`status`: stun / freeze / knock-up, root, slow), `def_shred` debuffs, stacking marks (`mark` / `detonate`),
 *               a forced target (`taunt`), damage-over-time (`dot`).
 *
 * The semantics are the ones of the design simulation (`skill_sim.ts`, docs/11 §4.5) so the server and the balance simulation agree; the
 * engine rules around the data's own numbers are `SKILL_EFFECTS` in `@vgtd/shared` (PROVISIONAL). Pure bookkeeping: no clocks (every time is
 * sim ms passed in), no randomness, iteration by ascending id / insertion order, `digest()` for the replay tests.
 */
import { SKILL_EFFECTS } from '@vgtd/shared';

export interface Buff {
  stat: string;
  mag: number;
  untilMs: number;
  src: number;
}

export interface MobFx {
  stunUntil: number;
  rootUntil: number;
  slowUntil: number;
  slowMag: number;
  marks: Map<string, { stacks: number; untilMs: number }>;
  shreds: { mag: number; untilMs: number }[];
  taunt: { pid: number; untilMs: number } | null;
}

export interface Dot {
  src: number;
  target: number;
  perTick: number;
  intervalMs: number;
  nextMs: number;
  untilMs: number;
  /** damage element context for the event: not needed to apply, kept for the harness / logs */
  skill: string;
}

export interface HotZone {
  src: number;
  /** heal each living member of `group` within `radius` of (i, j); a `self` zone has `radius` 0 and heals only `src` */
  group: readonly number[];
  i: number;
  j: number;
  radius: number;
  perTick: number;
  intervalMs: number;
  nextMs: number;
  untilMs: number;
}

/** A passive summon (`phu_linh`): strikes the nearest mob in range on its own interval. */
export interface Pet {
  coeff: number;
  intervalMs: number;
  nextMs: number;
}

/** Bits of the mob control mask on the wire (`StatusBit` in the protocol): root, slow, stun. */
export const MOB_MASK = { root: 1, slow: 2, stun: 8 } as const;

const newMobFx = (): MobFx => ({
  stunUntil: 0,
  rootUntil: 0,
  slowUntil: 0,
  slowMag: 0,
  marks: new Map(),
  shreds: [],
  taunt: null,
});

export class EffectSystem {
  private readonly buffs = new Map<number, Buff[]>();
  private readonly mobs = new Map<number, MobFx>();
  dots: Dot[] = [];
  zones: HotZone[] = [];
  private readonly pets = new Map<number, Pet>();

  // ------------------------------------------------------------------ players
  addBuff(id: number, b: Buff): void {
    const list = this.buffs.get(id) ?? [];
    // one buff per (stat, source): recasting refreshes it (the design simulation's rule)
    const kept = list.filter((x) => !(x.stat === b.stat && x.src === b.src));
    kept.push(b);
    this.buffs.set(id, kept);
  }
  /** Sum of the active buffs of `stat` on a player. */
  buffSum(id: number, stat: string, nowMs: number): number {
    let v = 0;
    for (const b of this.buffs.get(id) ?? []) if (b.stat === stat && b.untilMs > nowMs) v += b.mag;
    return v;
  }
  /** Active buffs (stat, magnitude) of a player, for tests / diagnostics. */
  buffsOf(id: number, nowMs: number): { stat: string; mag: number; src: number }[] {
    return (this.buffs.get(id) ?? [])
      .filter((b) => b.untilMs > nowMs)
      .map(({ stat, mag, src }) => ({ stat, mag, src }));
  }
  setPet(id: number, pet: Pet | null): void {
    if (pet) this.pets.set(id, pet);
    else this.pets.delete(id);
  }
  petsInOrder(): [number, Pet][] {
    return [...this.pets.entries()].sort((a, b) => a[0] - b[0]);
  }
  clearPlayer(id: number): void {
    this.buffs.delete(id);
    this.dots = this.dots.filter((d) => d.src !== id);
    this.zones = this.zones.filter((z) => z.src !== id);
  }

  // ------------------------------------------------------------------ mobs
  private fx(id: number): MobFx {
    let f = this.mobs.get(id);
    if (!f) {
      f = newMobFx();
      this.mobs.set(id, f);
    }
    return f;
  }
  hasMobFx(id: number): boolean {
    return this.mobs.has(id);
  }
  stunMob(id: number, nowMs: number, ms: number): void {
    const f = this.fx(id);
    f.stunUntil = Math.max(f.stunUntil, nowMs + ms);
  }
  rootMob(id: number, nowMs: number, ms: number): void {
    const f = this.fx(id);
    f.rootUntil = Math.max(f.rootUntil, nowMs + ms);
  }
  slowMob(id: number, nowMs: number, ms: number, mag: number): void {
    const f = this.fx(id);
    f.slowUntil = nowMs + ms;
    f.slowMag = Math.min(1, Math.max(0, mag));
  }
  shredMob(id: number, nowMs: number, ms: number, mag: number): void {
    this.fx(id).shreds.push({ mag, untilMs: nowMs + ms });
  }
  tauntMob(id: number, pid: number, nowMs: number, ms: number): void {
    this.fx(id).taunt = { pid, untilMs: nowMs + ms };
  }
  /** Add a stack of mark `markId` (refreshing it); returns the stacks after. Expired marks start over. */
  stackMark(id: number, markId: string, nowMs: number, ms: number): number {
    const f = this.fx(id);
    const cur = f.marks.get(markId);
    const stacks = (cur && cur.untilMs > nowMs ? cur.stacks : 0) + 1;
    f.marks.set(markId, { stacks, untilMs: nowMs + ms });
    return stacks;
  }
  /** Stacks of a live mark, 0 when none or expired. */
  marksOf(id: number, markId: string, nowMs: number): number {
    const m = this.mobs.get(id)?.marks.get(markId);
    return m && m.untilMs > nowMs ? m.stacks : 0;
  }
  clearMark(id: number, markId: string): void {
    this.mobs.get(id)?.marks.delete(markId);
  }

  isStunned(id: number, nowMs: number): boolean {
    return (this.mobs.get(id)?.stunUntil ?? 0) > nowMs;
  }
  isRooted(id: number, nowMs: number): boolean {
    return (this.mobs.get(id)?.rootUntil ?? 0) > nowMs;
  }
  /** Speed factor of a mob (1 = none): `1 - magnitude` of the active slow. */
  speedFactor(id: number, nowMs: number): number {
    const f = this.mobs.get(id);
    return f && f.slowUntil > nowMs ? 1 - f.slowMag : 1;
  }
  /** The player a mob is forced to attack (taunt), or 0. */
  taunter(id: number, nowMs: number): number {
    const t = this.mobs.get(id)?.taunt;
    return t && t.untilMs > nowMs ? t.pid : 0;
  }
  /** DEF multiplier of a mob from `def_shred` debuffs: 1 - min(cap, sum). */
  defMult(id: number, nowMs: number): number {
    let s = 0;
    for (const x of this.mobs.get(id)?.shreds ?? []) if (x.untilMs > nowMs) s += x.mag;
    return 1 - Math.min(SKILL_EFFECTS.SHRED_CAP, s);
  }
  /** `MOB_MASK` bits of a mob's active control (what the clients that see it are told). */
  maskOfMob(id: number, nowMs: number): number {
    const f = this.mobs.get(id);
    if (!f) return 0;
    return (
      (f.stunUntil > nowMs ? MOB_MASK.stun : 0) |
      (f.rootUntil > nowMs ? MOB_MASK.root : 0) |
      (f.slowUntil > nowMs ? MOB_MASK.slow : 0)
    );
  }
  /** Ids of mobs that have any effect state (for the status broadcast). */
  mobIds(): number[] {
    return [...this.mobs.keys()].sort((a, b) => a - b);
  }
  clearMob(id: number): void {
    this.mobs.delete(id);
    this.dots = this.dots.filter((d) => d.target !== id);
  }

  /** Drop what has expired (buffs, shreds, marks, finished dots / zones); keeps the maps small. */
  prune(nowMs: number): void {
    for (const [id, list] of this.buffs) {
      const kept = list.filter((b) => b.untilMs > nowMs);
      if (kept.length === 0) this.buffs.delete(id);
      else if (kept.length !== list.length) this.buffs.set(id, kept);
    }
    for (const [id, f] of this.mobs) {
      f.shreds = f.shreds.filter((x) => x.untilMs > nowMs);
      for (const [k, m] of f.marks) if (m.untilMs <= nowMs) f.marks.delete(k);
      if (f.taunt && f.taunt.untilMs <= nowMs) f.taunt = null;
      const idle =
        f.stunUntil <= nowMs &&
        f.rootUntil <= nowMs &&
        f.slowUntil <= nowMs &&
        f.shreds.length === 0 &&
        f.marks.size === 0 &&
        f.taunt === null;
      if (idle) this.mobs.delete(id);
    }
    this.dots = this.dots.filter((d) => d.untilMs > nowMs);
    this.zones = this.zones.filter((z) => z.untilMs > nowMs);
  }

  digest(): string {
    return JSON.stringify({
      buffs: [...this.buffs.entries()].sort((a, b) => a[0] - b[0]),
      mobs: [...this.mobs.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([id, f]) => [
          id,
          f.stunUntil,
          f.rootUntil,
          f.slowUntil,
          f.slowMag,
          [...f.marks.entries()],
          f.shreds,
          f.taunt,
        ]),
      dots: this.dots,
      zones: this.zones,
      pets: this.petsInOrder(),
    });
  }
}
