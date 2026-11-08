import { describe, expect, it } from 'vitest';
import { HIT_FLAG_CRIT, HIT_FLAG_KILL } from '@vgtd/shared';
import { compileSkills } from '@vgtd/sim';
import { PLAYER_ID, ServerCombat, wireSkillIds } from '../src/index.js';
import type { CombatEvent, SkillCastWire } from '../src/index.js';

const make = () => {
  const sent: SkillCastWire[] = [];
  const c = new ServerCombat({
    path: 'kiem',
    send: (m) => {
      sent.push(m);
    },
  });
  c.setSelfVitals({ hp: 1200, hpMax: 1200, mp: 400, mpMax: 400 });
  c.upsertEnemy({ id: 1_000_001, name: 'mob', pos: { i: 22, j: 20 }, hpPct: 100, hpMax: 3000 });
  return { c, sent };
};

describe('wire skill ids', () => {
  it('match @vgtd/sim compileSkills for every active skill (the id the server expects in skill_cast)', () => {
    const ids = wireSkillIds();
    const compiled = compileSkills();
    expect(ids.size).toBe(compiled.length);
    for (const s of compiled) expect(ids.get(s.key)).toBe(s.id);
  });
});

describe('ServerCombat', () => {
  it('sends skill_cast with the wire id, the current target and an increasing seq; predicts cooldown + GCD + cast bar', () => {
    const { c, sent } = make();
    const slot = c.hotbar.slots.findIndex((s) => s.skill.id === 'kiem_khi_tram');
    c.target.select(1_000_001);
    const ev = c.cast(slot, 1000);
    expect(ev).toEqual([{ type: 'cast_start', slot, castMs: 400, atMs: 1000 }]);
    expect(sent).toEqual([{ seq: 1, skillId: wireSkillIds().get('kiem_khi_tram'), targetId: 1_000_001, aim: null }]);
    expect(c.hotbar.cooldownRemainingMs(slot, 1000)).toBe(3000);
    expect(c.player.casting).toEqual({ slot, startedAt: 1000, endsAt: 1400 });
    // GCD blocks the next cast locally, without sending anything
    const other = c.hotbar.slots.findIndex((s) => s.skill.id === 'lien_hoan_kiem');
    expect(c.cast(other, 1100)).toEqual([{ type: 'blocked', slot: other, reason: 'gcd', atMs: 1100 }]);
    expect(sent).toHaveLength(1);
  });

  it('turns a resolved skill_result into damage / crit / kill events, clears the cast bar and syncs the cooldown to the server', () => {
    const { c } = make();
    const slot = c.hotbar.slots.findIndex((s) => s.skill.id === 'kiem_khi_tram');
    c.cast(slot, 1000);
    c.setServerTime(20_000);
    c.applySkillResult(
      {
        seq: 1,
        reason: 0,
        skillId: wireSkillIds().get('kiem_khi_tram')!,
        readyAtMs: 22_500,
        hits: [{ targetIndex: 7, damage: 333, flags: HIT_FLAG_CRIT | HIT_FLAG_KILL }],
      },
      1450,
      (i) => (i === 7 ? 1_000_001 : undefined),
    );
    expect(c.player.casting).toBeNull();
    expect(c.hotbar.cooldownRemainingMs(slot, 1450)).toBe(2500); // server: ready in 2.5 s
    const ev = c.update(1450);
    expect(ev).toContainEqual({
      type: 'damage',
      targetId: 1_000_001,
      amount: 333,
      crit: true,
      sourceId: PLAYER_ID,
      atMs: 1450,
    });
    expect(ev).toContainEqual({ type: 'death', id: 1_000_001, atMs: 1450 });
    expect(ev).toContainEqual({ type: 'cast_done', slot, atMs: 1450 });
    expect(c.enemy(1_000_001)!.alive).toBe(false);
  });

  it('a server rejection restores the real cooldown (Cooldown) or drops the prediction (e.g. no mana) and shows the reason', () => {
    const { c } = make();
    const slot = c.hotbar.slots.findIndex((s) => s.skill.id === 'kiem_khi_tram');
    const skillId = wireSkillIds().get('kiem_khi_tram')!;
    c.cast(slot, 1000);
    c.setServerTime(50_000);
    c.applySkillResult({ seq: 1, reason: 2, skillId, readyAtMs: 51_000, hits: [] }, 1100, () => undefined);
    expect(c.hotbar.cooldownRemainingMs(slot, 1100)).toBe(1000);
    expect((c.update(1100) as CombatEvent[])[0]).toMatchObject({ type: 'blocked', reason: 'cooldown' });
    // out of range: prediction undone
    c.hotbar.reset();
    c.cast(slot, 5000);
    c.applySkillResult({ seq: 2, reason: 6, skillId, readyAtMs: 0, hits: [] }, 5050, () => undefined);
    expect(c.hotbar.cooldownRemainingMs(slot, 5050)).toBe(0);
    expect((c.update(5050) as CombatEvent[])[0]).toMatchObject({ type: 'blocked', reason: 'range' });
  });

  it('a refusal undoes only the prediction of that cast: the real cooldown of another slot and a running GCD survive', () => {
    const { c } = make();
    const idx = (id: string) => c.hotbar.slots.findIndex((s) => s.skill.id === id);
    const a = idx('kiem_khi_tram'); // gcd, 3 s cooldown
    const b = idx('lien_hoan_kiem'); // gcd, 7 s cooldown
    const free = idx('thiem_kiem_bo'); // gcd:false
    const wire = (id: string) => wireSkillIds().get(id)!;
    c.target.select(1_000_001);
    c.setServerTime(1000);
    c.cast(a, 1000);
    c.applySkillResult(
      { seq: 1, reason: 0, skillId: wire('kiem_khi_tram'), readyAtMs: 4000, hits: [] },
      1450,
      () => undefined,
    );
    expect(c.hotbar.cooldownRemainingMs(a, 2000)).toBe(2450);
    // slot B is pressed after the GCD and refused for range: A must stay on cooldown, B must not keep a predicted cooldown
    c.cast(b, 2000);
    expect(c.hotbar.cooldownRemainingMs(b, 2000)).toBe(7000);
    c.applySkillResult(
      { seq: 2, reason: 6, skillId: wire('lien_hoan_kiem'), readyAtMs: 0, hits: [] },
      2050,
      () => undefined,
    );
    expect(c.hotbar.cooldownRemainingMs(b, 2050)).toBe(0);
    expect(c.hotbar.cooldownRemainingMs(a, 2050)).toBe(2400);
    expect((c.update(2050) as CombatEvent[]).some((e) => e.type === 'blocked' && e.reason === 'range')).toBe(true);
    // a gcd:false skill pressed while A's GCD runs is refused: the GCD of A (not committed by it) is untouched
    const c2 = make().c;
    c2.setServerTime(0);
    c2.cast(a, 10_000);
    const gcdBefore = c2.hotbar.gcdFraction(10_100);
    c2.cast(free, 10_100);
    c2.applySkillResult(
      { seq: 2, reason: 6, skillId: wire('thiem_kiem_bo'), readyAtMs: 0, hits: [] },
      10_150,
      () => undefined,
    );
    expect(c2.hotbar.gcdFraction(10_100)).toBe(gcdBefore);
    expect(c2.hotbar.gcdFraction(10_100)).toBeGreaterThan(0);
    // refused while its own GCD was the only thing running: the prediction's GCD goes away
    const c3 = make().c;
    c3.cast(a, 20_000);
    c3.applySkillResult(
      { seq: 1, reason: 6, skillId: wire('kiem_khi_tram'), readyAtMs: 0, hits: [] },
      20_050,
      () => undefined,
    );
    expect(c3.hotbar.gcdFraction(20_100)).toBe(0);
    expect(c3.hotbar.cooldownRemainingMs(a, 20_100)).toBe(0);
  });

  it('a Gcd refusal syncs the GCD (readyAtMs is the GCD ready time) and clears the slot prediction instead of using it as a cooldown', () => {
    const { c } = make();
    const a = c.hotbar.slots.findIndex((s) => s.skill.id === 'kiem_khi_tram');
    c.setServerTime(50_000);
    c.cast(a, 1000);
    c.applySkillResult(
      { seq: 1, reason: 3, skillId: wireSkillIds().get('kiem_khi_tram')!, readyAtMs: 50_600, hits: [] },
      1100,
      () => undefined,
    );
    expect(c.hotbar.cooldownRemainingMs(a, 1100)).toBe(0);
    expect(c.hotbar.gcdFraction(1100)).toBeGreaterThan(0);
    expect(c.hotbar.blockedBy(a, 1100)).toBe('gcd');
    expect(c.hotbar.blockedBy(a, 1100 + 600)).toBeNull();
  });

  it('blocks locally when dead, on a passive, or without MP; tracks enemy HP from hpPct and drops dead targets', () => {
    const { c, sent } = make();
    const passive = c.hotbar.slots.findIndex((s) => !s.castable);
    expect(c.cast(passive, 0)[0]).toMatchObject({ reason: 'passive' });
    c.player.mp = 0;
    const costly = c.hotbar.slots.findIndex((s) => s.castable && (s.skill.cost?.mp_pct ?? 0) > 0);
    expect(c.cast(costly, 0)[0]).toMatchObject({ reason: 'mp' });
    c.setSelfVitals({ hp: 0, hpMax: 1200, mp: 400, mpMax: 400, alive: false });
    expect(c.cast(0, 0)[0]).toMatchObject({ reason: 'dead' });
    expect(sent).toHaveLength(0);
    c.upsertEnemy({ id: 1_000_001, name: 'mob', pos: { i: 22, j: 20 }, hpPct: 40, hpMax: 3000 });
    expect(c.enemy(1_000_001)).toMatchObject({ hp: 1200, alive: true });
    c.target.select(1_000_001);
    c.upsertEnemy({ id: 1_000_001, name: 'mob', pos: { i: 22, j: 20 }, hpPct: 0, hpMax: 3000 });
    c.update(10);
    expect(c.target.current).toBeNull();
    c.removeEnemy(1_000_001);
    expect(c.enemies).toHaveLength(0);
  });

  it('sends the aim point pulled back to the skill range, and none when the pointer is unknown', () => {
    const { c, sent } = make();
    c.setPlayerPos({ i: 20, j: 20 });
    const grounded = c.hotbar.slots.findIndex((s) => s.skill.id === 'ngu_kiem_tran'); // ground, range 8
    c.setAim({ i: 26, j: 20 }); // 6 tiles: within range, sent as is
    c.cast(grounded, 1000);
    expect(sent[0]!.aim).toEqual({ i: 26, j: 20 });
    c.hotbar.reset();
    c.setAim({ i: 60, j: 20 }); // 40 tiles: pulled back to range 8 along the same direction
    c.cast(grounded, 5000);
    expect(sent[1]!.aim!.i).toBeCloseTo(28, 10);
    expect(sent[1]!.aim!.j).toBeCloseTo(20, 10);
    c.hotbar.reset();
    c.setAim(null);
    c.cast(grounded, 9000);
    expect(sent[2]!.aim).toBeNull();
    c.hotbar.reset();
    c.setAim({ i: Number.NaN, j: 1 });
    c.cast(grounded, 13_000);
    expect(sent[3]!.aim).toBeNull();
  });

  it('a transport that refuses the send (socket closed) takes the prediction back and reports busy', () => {
    const c = new ServerCombat({ path: 'kiem', send: () => false });
    c.setSelfVitals({ hp: 1200, hpMax: 1200, mp: 400, mpMax: 400 });
    const slot = c.hotbar.slots.findIndex((s) => s.skill.id === 'kiem_khi_tram');
    expect(c.cast(slot, 1000)).toEqual([{ type: 'blocked', slot, reason: 'busy', atMs: 1000 }]);
    expect(c.hotbar.cooldownRemainingMs(slot, 1000)).toBe(0);
    expect(c.hotbar.gcdFraction(1000)).toBe(0);
    expect(c.player.casting).toBeNull();
  });

  it('syncEnemy updates a known enemy from the remote view and ignores unknown ids', () => {
    const { c } = make();
    c.syncEnemy(1_000_001, { i: 30, j: 31 }, 50);
    expect(c.enemy(1_000_001)).toMatchObject({ pos: { i: 30, j: 31 }, hp: 1500, alive: true });
    c.syncEnemy(1_000_001, { i: 30, j: 31 }, 0);
    expect(c.enemy(1_000_001)).toMatchObject({ hp: 0, alive: false });
    c.syncEnemy(5, { i: 0, j: 0 }, 100);
    expect(c.enemy(5)).toBeUndefined();
  });

  it('a result that never arrives does not freeze the cast bar', () => {
    const { c } = make();
    const slot = c.hotbar.slots.findIndex((s) => s.skill.id === 'kiem_khi_tram');
    c.cast(slot, 0);
    c.update(400 + 1501);
    expect(c.player.casting).toBeNull();
  });
});
