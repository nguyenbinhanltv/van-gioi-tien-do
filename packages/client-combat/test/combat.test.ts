import { describe, expect, it } from 'vitest';
import { PATHS, skillDefinitions, skillsOf } from '@vgtd/shared';
import { HOTBAR_SLOTS, Hotbar, MockCombat, PLAYER_ID, TargetSelector } from '../src/index.js';
import type { CombatEvent, Targetable } from '../src/index.js';

/** mulberry32: deterministic test RNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Hotbar', () => {
  it('has the 8 skills of every class in unlock order (D49)', () => {
    for (const path of PATHS) {
      const bar = new Hotbar(path);
      expect(bar.slots).toHaveLength(HOTBAR_SLOTS);
      expect(bar.slots.map((s) => s.skill.id)).toEqual(skillsOf(path).map((s) => s.id));
      for (const s of bar.slots) expect(s.castable).toBe(s.skill.kind === 'active');
    }
    expect(new Hotbar('kiem').gcdMs).toBe(skillDefinitions.global.gcd_ms ?? 800);
  });

  it('runs per-slot cooldown and the GCD; gcd:false skills ignore the GCD', () => {
    const bar = new Hotbar('kiem');
    const first = bar.slots.findIndex((s) => s.castable && s.skill.timing.gcd !== false);
    const second = bar.slots.findIndex((s, i) => i !== first && s.castable && s.skill.timing.gcd !== false);
    const free = bar.slots.findIndex((s) => s.castable && s.skill.timing.gcd === false);
    expect(free).toBeGreaterThanOrEqual(0);
    expect(bar.blockedBy(first, 0)).toBeNull();
    bar.commit(first, 1000);
    const cd = bar.slots[first]!.skill.timing.cooldown_ms;
    expect(bar.blockedBy(first, 1000 + bar.gcdMs / 2)).toBe('cooldown');
    expect(bar.cooldownFraction(first, 1000)).toBe(1);
    expect(bar.cooldownFraction(first, 1000 + cd / 2)).toBeCloseTo(0.5, 6);
    expect(bar.cooldownFraction(first, 1000 + cd)).toBe(0);
    // another GCD skill is blocked only during the GCD
    expect(bar.blockedBy(second, 1000 + bar.gcdMs - 1)).toBe('gcd');
    expect(bar.gcdFraction(1000 + bar.gcdMs / 2)).toBeCloseTo(0.5, 6);
    expect(bar.blockedBy(second, 1000 + bar.gcdMs)).toBeNull();
    // a gcd:false skill is castable during the GCD
    expect(bar.blockedBy(free, 1000 + 1)).toBeNull();
    expect(bar.blockedBy(first, 1000 + cd)).toBeNull();
  });

  it('refuses passives and empty slots', () => {
    const bar = new Hotbar('kiem');
    const passive = bar.slots.findIndex((s) => !s.castable);
    expect(bar.blockedBy(passive, 0)).toBe('passive');
    expect(bar.blockedBy(99, 0)).toBe('empty');
  });
});

describe('TargetSelector', () => {
  const dummies: Targetable[] = [
    { id: 1, pos: { i: 10, j: 10 }, alive: true, hostile: true },
    { id: 2, pos: { i: 12, j: 10 }, alive: true, hostile: true },
    { id: 3, pos: { i: 14, j: 10 }, alive: true, hostile: true },
    { id: 4, pos: { i: 11, j: 10 }, alive: false, hostile: true },
    { id: 5, pos: { i: 10.5, j: 10 }, alive: true, hostile: false },
  ];

  it('picks the nearest alive hostile near a clicked point', () => {
    const t = new TargetSelector();
    expect(t.pickAt(dummies, { i: 12.3, j: 10.2 })).toBe(2);
    expect(t.current).toBe(2);
    expect(t.pickAt(dummies, { i: 30, j: 30 })).toBeNull();
    expect(t.current).toBe(2); // unchanged on a miss
  });

  it('tab cycles nearest first within range, wraps, skips dead / friendly and goes backwards', () => {
    const t = new TargetSelector();
    const from = { i: 9, j: 10 };
    expect([t.cycle(dummies, from), t.cycle(dummies, from), t.cycle(dummies, from), t.cycle(dummies, from)]).toEqual([
      1, 2, 3, 1,
    ]);
    expect(t.cycle(dummies, from, 15, true)).toBe(3);
    expect(t.cycle(dummies, from, 2.5)).toBe(1); // only id 1 within 2.5 tiles; current 3 is out of range -> nearest
    const none = new TargetSelector();
    expect(none.cycle(dummies, { i: 100, j: 100 })).toBeNull();
  });

  it('validate() clears a dead target', () => {
    const t = new TargetSelector();
    const list: Targetable[] = [{ id: 1, pos: { i: 0, j: 0 }, alive: true, hostile: true }];
    t.select(1);
    expect(t.validate(list)).toBe(false);
    list[0]!.alive = false;
    expect(t.validate(list)).toBe(true);
    expect(t.current).toBeNull();
  });
});

describe('MockCombat', () => {
  const make = (path: 'kiem' | 'phap' | 'dan_phu' = 'kiem', extra: Record<string, unknown> = {}) =>
    new MockCombat({
      path,
      rand: rng(42),
      playerPos: { i: 10, j: 10 },
      enemies: [
        { name: 'near', pos: { i: 11, j: 10 } },
        { name: 'far', pos: { i: 30, j: 10 }, fightsBack: false },
      ],
      ...extra,
    });
  const dmg = (ev: CombatEvent[]) => ev.filter((e) => e.type === 'damage');

  it('needs a target and range, spends MP, casts after cast_ms and deals damage', () => {
    const c = make();
    const slot = c.hotbar.slots.findIndex(
      (s) => s.castable && s.skill.timing.cast_ms > 0 && s.skill.targeting.mode !== 'self',
    );
    const skill = c.hotbar.slot(slot)!.skill;
    expect(c.cast(slot, 0)).toEqual([{ type: 'blocked', slot, reason: 'no_target', atMs: 0 }]);
    c.target.select(2); // far away
    expect(c.cast(slot, 0)[0]).toMatchObject({ type: 'blocked', reason: 'range' });
    c.target.select(1);
    const mp0 = c.player.mp;
    const start = c.cast(slot, 100);
    expect(start).toEqual([{ type: 'cast_start', slot, castMs: skill.timing.cast_ms, atMs: 100 }]);
    expect(c.player.mp).toBeLessThan(mp0);
    expect(c.cast(slot, 150)[0]).toMatchObject({ type: 'blocked', reason: 'busy' });
    expect(dmg(c.update(100 + skill.timing.cast_ms - 1))).toHaveLength(0);
    const hp0 = c.enemy(1)!.hp;
    const done = c.update(100 + skill.timing.cast_ms);
    expect(done.some((e) => e.type === 'cast_done')).toBe(true);
    if (skill.effects.some((e) => e.type === 'damage')) {
      expect(dmg(done).length).toBeGreaterThan(0);
      expect(c.enemy(1)!.hp).toBeLessThan(hp0);
    }
    expect(c.cast(slot, 100 + skill.timing.cast_ms + 1)[0]).toMatchObject({ type: 'blocked' }); // cooldown / gcd
  });

  it('is deterministic for the same seed and inputs', () => {
    const run = () => {
      const c = make();
      c.target.select(1);
      const log: CombatEvent[] = [];
      let t = 0;
      for (let step = 0; step < 400; step++) {
        t += 100;
        for (let s = 0; s < 8; s++) log.push(...c.cast(s, t));
        log.push(...c.update(t));
      }
      return JSON.stringify(log);
    };
    expect(run()).toBe(run());
  });

  it('kills a dummy, clears the target, and respawns it after MOCK.RESPAWN_MS', () => {
    const c = make('kiem', {});
    c.enemies[0]!.hp = 1;
    c.target.select(1);
    const slot = c.hotbar.slots.findIndex((s) => s.castable && s.skill.effects.some((e) => e.type === 'damage'));
    c.cast(slot, 0);
    const out = c.update(2000);
    expect(out.some((e) => e.type === 'death' && e.id === 1)).toBe(true);
    expect(c.enemy(1)!.alive).toBe(false);
    expect(c.target.current).toBeNull();
    const back = c.update(2000 + 5000);
    expect(back.some((e) => e.type === 'respawn' && e.id === 1)).toBe(true);
    expect(c.enemy(1)!.hp).toBe(c.enemy(1)!.hpMax);
  });

  it('a hostile dummy hurts the player; shields absorb; death blocks casts and respawns', () => {
    const c = new MockCombat({
      path: 'kiem',
      rand: rng(1),
      playerPos: { i: 0, j: 0 },
      enemies: [{ name: 'hostile', pos: { i: 1, j: 0 }, fightsBack: true }],
    });
    c.update(1); // arms the enemy attack timer
    const ev = c.update(5000);
    expect(ev.some((e) => e.type === 'damage' && e.targetId === PLAYER_ID)).toBe(true);
    expect(c.player.hp).toBeLessThan(c.player.hpMax);
    c.player.shield = 10_000;
    const hp = c.player.hp;
    c.update(9000);
    expect(c.player.hp).toBe(hp);
    c.player.shield = 0;
    c.player.hp = 1;
    c.update(13000);
    expect(c.player.alive).toBe(false);
    expect(c.cast(0, 13001)[0]).toMatchObject({ type: 'blocked', reason: 'dead' });
    c.update(13000 + 5000);
    expect(c.player.alive).toBe(true);
    expect(c.player.hp).toBe(c.player.hpMax);
  });

  it('heals and shields from self skills; MP gate blocks with reason mp', () => {
    const c = make('dan_phu');
    c.player.hp = 1;
    const heal = c.hotbar.slots.findIndex((s) => s.castable && s.skill.effects.some((e) => e.type === 'heal'));
    expect(heal).toBeGreaterThanOrEqual(0);
    c.cast(heal, 0);
    c.update(5000);
    expect(c.player.hp).toBeGreaterThan(1);
    c.player.mp = 0;
    const costly = c.hotbar.slots.findIndex(
      (s, i) => s.castable && i !== heal && (s.skill.cost?.mp_pct ?? 0) > 0 && s.skill.targeting.mode === 'self',
    );
    if (costly >= 0) expect(c.cast(costly, 100000)[0]).toMatchObject({ type: 'blocked', reason: 'mp' });
  });
});

describe('MockCombat enemy defId', () => {
  it('carries the optional mob wire id of a spec to the enemy view (art only)', () => {
    const c = new MockCombat({
      path: 'kiem',
      rand: rng(1),
      playerPos: { i: 10, j: 10 },
      enemies: [
        { name: 'Mob 4', defId: 4, pos: { i: 12, j: 10 } },
        { name: 'dummy', pos: { i: 14, j: 10 } },
      ],
    });
    expect(c.enemies[0]?.defId).toBe(4);
    expect(c.enemies[1]?.defId).toBeUndefined();
  });
});
