import { describe, expect, it } from 'vitest';
import { COMBAT_RULES } from '@vgtd/shared';
import { OVERHEAD_BAR, PLAYER_ID, ServerCombat, VitalsWatcher, overheadBar, respawnLeftMs } from '../src/index.js';

describe('overheadBar', () => {
  it('hides full-HP and dead entities, shows the targeted one at full alpha', () => {
    expect(overheadBar({ hp: 100, hpMax: 100, kind: 'enemy' }).visible).toBe(false);
    expect(overheadBar({ hp: 0, hpMax: 100, kind: 'enemy', targeted: true }).visible).toBe(false);
    expect(overheadBar({ hp: 50, hpMax: 100, alive: false, kind: 'ally' }).visible).toBe(false);
    expect(overheadBar({ hp: 100, hpMax: 100, kind: 'enemy', targeted: true })).toEqual({
      visible: true,
      fraction: 1,
      alpha: 1,
      tone: 'target',
    });
  });
  it('shows a hurt monster for a while after the hit, then fades and hides it', () => {
    const at = (sinceHurtMs: number) => overheadBar({ hp: 30, hpMax: 100, kind: 'enemy', sinceHurtMs });
    expect(at(0)).toMatchObject({ visible: true, alpha: 1, fraction: 0.3, tone: 'enemy' });
    const mid = at(OVERHEAD_BAR.LINGER_MS - OVERHEAD_BAR.FADE_MS / 2);
    expect(mid.visible).toBe(true);
    expect(mid.alpha).toBeCloseTo(0.5, 5);
    expect(at(OVERHEAD_BAR.LINGER_MS).visible).toBe(false);
    expect(overheadBar({ hp: 30, hpMax: 100, kind: 'enemy' }).visible).toBe(false); // never seen hurt (joined hurt)
  });
  it('keeps the own bar up while hurt and clamps the fraction', () => {
    expect(overheadBar({ hp: 10, hpMax: 100, kind: 'self', sinceHurtMs: 99_999 })).toMatchObject({
      visible: true,
      tone: 'self',
    });
    expect(overheadBar({ hp: 500, hpMax: 100, kind: 'ally', targeted: true }).fraction).toBe(1);
    expect(overheadBar({ hp: 5, hpMax: 0, kind: 'ally' }).visible).toBe(false);
  });
});

describe('respawnLeftMs', () => {
  it('counts down the server respawn delay and never goes negative', () => {
    expect(respawnLeftMs(1000, 1000)).toBe(COMBAT_RULES.RESPAWN_PVE_MS);
    expect(respawnLeftMs(1000, 4000)).toBe(COMBAT_RULES.RESPAWN_PVE_MS - 3000);
    expect(respawnLeftMs(1000, 1_000_000)).toBe(0);
    expect(respawnLeftMs(0, 2500, 5000)).toBe(2500);
  });
});

describe('VitalsWatcher', () => {
  const v = (hp: number, alive = hp > 0, hpMax = 1000) => ({ hp, hpMax, alive });
  it('the first sample is only a baseline', () => {
    const w = new VitalsWatcher();
    expect(w.feed(v(1000), 0)).toEqual([]);
  });
  it('damage taken, heal, death and respawn (the refill is not a heal)', () => {
    const w = new VitalsWatcher();
    w.feed(v(1000), 0);
    expect(w.feed(v(900), 100)).toEqual([
      { type: 'damage', targetId: PLAYER_ID, amount: 100, crit: false, sourceId: 0, atMs: 100 },
    ]);
    expect(w.lastHurtAtMs).toBe(100);
    expect(w.feed(v(950), 200)).toEqual([{ type: 'heal', targetId: PLAYER_ID, amount: 50, atMs: 200 }]);
    expect(w.lastHurtAtMs).toBe(100);
    const dead = w.feed(v(0), 300);
    expect(dead.map((e) => e.type)).toEqual(['damage', 'death']);
    expect(w.diedAtMs).toBe(300);
    expect(w.feed(v(0), 400)).toEqual([]);
    expect(w.feed(v(1000), 500)).toEqual([{ type: 'respawn', id: PLAYER_ID, atMs: 500 }]);
    expect(w.diedAtMs).toBeNull();
  });
  it('a max HP change (realm up) is not a heal; fractional HP rounds', () => {
    const w = new VitalsWatcher();
    w.feed(v(1000), 0);
    expect(w.feed(v(1500, true, 1500), 10)).toEqual([]);
    expect(w.feed(v(1499.6, true, 1500), 20)).toEqual([]); // rounds to a delta of 0 (-0.4)
  });
  it('a client that logs in dead starts the countdown at the first sample', () => {
    const w = new VitalsWatcher();
    w.feed(v(0), 777);
    expect(w.diedAtMs).toBe(777);
  });
});

describe('ServerCombat own vitals -> HUD events', () => {
  it('emits damage / death / respawn events on the next update and cancels the cast bar when dead', () => {
    const c = new ServerCombat({ path: 'kiem', send: () => true });
    c.update(0);
    c.setSelfVitals({ hp: 1200, hpMax: 1200, mp: 400, mpMax: 400 });
    c.setSelfVitals({ hp: 1000, hpMax: 1200, mp: 400, mpMax: 400 });
    c.update(100);
    c.player.casting = { slot: 0, startedAt: 0, endsAt: 500 };
    c.setSelfVitals({ hp: 0, hpMax: 1200, mp: 400, mpMax: 400, alive: false }, 200);
    expect(c.player.alive).toBe(false);
    expect(c.player.casting).toBeNull();
    const ev = c.update(210);
    expect(ev.map((e) => e.type)).toEqual(['damage', 'death']);
    expect(c.cast(0, 300)[0]).toMatchObject({ type: 'blocked', reason: 'dead' });
    c.setSelfVitals({ hp: 1200, hpMax: 1200, mp: 400, mpMax: 400, alive: true }, 5000);
    expect(c.update(5010).map((e) => e.type)).toEqual(['respawn']);
    expect(c.player.alive).toBe(true);
  });
});
