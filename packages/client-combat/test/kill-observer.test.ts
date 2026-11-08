import { describe, expect, it } from 'vitest';
import { HIT_FLAG_KILL } from '@vgtd/shared';
import { ServerCombat, withKillObserver, wireSkillIds } from '../src/index.js';

const MOB = 1_000_001;
function make(): { c: ServerCombat; kills: number[]; wrapped: ReturnType<typeof withKillObserver> } {
  const c = new ServerCombat({ path: 'kiem', send: () => undefined });
  c.setSelfVitals({ hp: 1200, hpMax: 1200, mp: 400, mpMax: 400 });
  c.upsertEnemy({ id: MOB, name: 'mob', pos: { i: 22, j: 20 }, hpPct: 100, hpMax: 3000 });
  c.upsertEnemy({ id: MOB + 1, name: 'mob', pos: { i: 24, j: 20 }, hpPct: 100, hpMax: 3000 });
  const kills: number[] = [];
  return { c, kills, wrapped: withKillObserver(c, (id) => kills.push(id)) };
}
const slotOf = (c: ServerCombat): number => c.hotbar.slots.findIndex((s) => s.skill.id === 'kiem_khi_tram');
const result = (seq: number, flags: number, target = 7) => ({
  seq,
  reason: 0,
  skillId: wireSkillIds().get('kiem_khi_tram')!,
  readyAtMs: 5000,
  hits: [{ targetIndex: target, damage: 10, flags }],
});

describe('withKillObserver (D84): counts the player own kills from the server skill_result', () => {
  it('reports a KILL-flagged hit once, with the enemy id; a plain hit and an enemy leaving the view report nothing', () => {
    const { c, kills, wrapped } = make();
    const slot = slotOf(c);
    wrapped.cast(slot, 1000);
    c.setServerTime(20_000);
    c.applySkillResult(result(1, 0), 1450, (i) => (i === 7 ? MOB : undefined)); // damage only
    expect(wrapped.update(1450)).toBeTruthy();
    expect(kills).toEqual([]);
    c.removeEnemy(MOB + 1); // despawned / out of AOI: not a kill by the player
    expect(wrapped.update(1500)).toBeTruthy();
    expect(kills).toEqual([]);
    wrapped.cast(slot, 4000);
    c.applySkillResult(result(2, HIT_FLAG_KILL), 4450, (i) => (i === 7 ? MOB : undefined));
    wrapped.update(4450);
    expect(kills).toEqual([MOB]);
    wrapped.update(4500); // events are drained: no double count
    expect(kills).toEqual([MOB]);
  });

  it('passes properties and methods through unchanged (the HUD cannot tell it is wrapped)', () => {
    const { c, wrapped } = make();
    expect(wrapped.hotbar).toBe(c.hotbar);
    expect(wrapped.target).toBe(c.target);
    expect(wrapped.enemies.map((e) => e.id)).toEqual([MOB, MOB + 1]);
    expect(wrapped.enemy(MOB)).toBe(c.enemy(MOB));
    wrapped.setPlayerPos({ i: 5, j: 6 });
    expect(c.player.pos).toEqual({ i: 5, j: 6 });
    const ev = wrapped.cast(slotOf(c), 1000);
    expect(ev[0]).toMatchObject({ type: 'cast_start' });
  });
});
