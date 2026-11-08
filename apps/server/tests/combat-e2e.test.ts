import { describe, expect, it } from 'vitest';
import { NETWORK } from '@vgtd/shared';
import { ServerCombat, wireSkillIds, type CombatEvent } from '@vgtd/client-combat';
import { ErrorCode, decode, dequantizePos, encode, type BaselinePos, type Message } from '@vgtd/protocol';
import { spawnEntity } from '@vgtd/sim';
import { WorldNode, makeProfile, type ClientTransport, type MobCombatStats, type MobPort } from '../src/index.js';

/**
 * End to end through the real wire encoding: a real WorldNode (combat on) talks to a real ServerCombat (the client-side backend of the
 * online HUD). The "network" only decodes the node's frames and routes them the way OnlineSession does with the NetClient hooks.
 */
const MOB = 1_000_001;

class Mobs implements MobPort {
  killed: number[] = [];
  readonly stats = new Map<number, MobCombatStats>();
  combatStats(id: number): MobCombatStats | undefined {
    return this.killed.includes(id) ? undefined : this.stats.get(id);
  }
  kill(world: import('@vgtd/sim').SimWorld, id: number): import('@vgtd/sim').SimWorld {
    this.killed.push(id);
    return { ...world, entities: world.entities.filter((e) => e.id !== id) };
  }
}

/** Client side of the pipe: decodes frames (with the delta baseline) and drives a ServerCombat like OnlineSession does. */
class Pipe implements ClientTransport {
  known = new Map<number, BaselinePos>();
  ids = new Map<number, number>(); // visible index -> entity id
  hpMax = new Map<number, number>();
  closed: ErrorCode | null = null;
  results = 0;
  constructor(
    readonly sc: ServerCombat,
    readonly now: () => number,
  ) {}

  send(data: Uint8Array): void {
    const m: Message = decode(data, { baseline: (i) => this.known.get(i) });
    if (m.type === 'aoi_enter') {
      for (const e of m.entities) {
        this.known.set(e.index, { qi: e.qi, qj: e.qj });
        this.ids.set(e.index, e.entityId);
        // a real MobManager marks monsters kind 1; this test's plain fake port does not, so the mob id range counts too
        if (e.kind === 1 || e.entityId >= MOB) {
          this.hpMax.set(e.entityId, e.maxHp);
          this.sc.upsertEnemy({
            id: e.entityId,
            name: `Mob ${e.defId}`,
            pos: { i: dequantizePos(e.qi), j: dequantizePos(e.qj) },
            hpPct: e.hpPct,
            hpMax: e.maxHp,
          });
        }
      }
    } else if (m.type === 'snapshot') {
      this.sc.setServerTime(m.tick * NETWORK.TICK_MS);
      if (m.self?.vitals) {
        const v = m.self.vitals;
        this.sc.setSelfVitals({
          hp: v.hp,
          hpMax: v.hpMax,
          mp: v.mp,
          mpMax: v.mpMax,
          shield: v.shield,
          alive: v.hp > 0,
        });
      }
      for (const e of m.entities) {
        this.known.set(e.index, { qi: e.qi, qj: e.qj });
        const id = this.ids.get(e.index);
        if (id !== undefined && e.hpPct !== null && this.sc.enemy(id))
          this.sc.syncEnemy(id, { i: dequantizePos(e.qi), j: dequantizePos(e.qj) }, e.hpPct);
      }
    } else if (m.type === 'skill_result') {
      this.results++;
      this.sc.applySkillResult(m, this.now(), (i) => this.ids.get(i));
    } else if (m.type === 'aoi_leave') {
      for (const i of m.indices) {
        const id = this.ids.get(i);
        if (id !== undefined) this.sc.removeEnemy(id);
        this.known.delete(i);
        this.ids.delete(i);
      }
    }
  }
  close(code: ErrorCode): void {
    this.closed = code;
  }
  buffered(): number {
    return 0;
  }
}

function setup() {
  const mobs = new Mobs();
  const node = new WorldNode({ seed: 11, mapTiles: 64, spawn: { i0: 20, j0: 20, side: 1 }, combat: { mobs } });
  let clock = 0;
  let nodeRef: WorldNode = node;
  let id = 0;
  const sc = new ServerCombat({
    path: 'kiem',
    send: (m) => {
      nodeRef.receive(
        id,
        encode({
          type: 'skill_cast',
          seq: m.seq,
          skillId: m.skillId,
          targetId: m.targetId,
          aim: m.aim ? { qi: Math.round(m.aim.i * 32), qj: Math.round(m.aim.j * 32) } : null,
        }),
      );
    },
  });
  const pipe = new Pipe(sc, () => clock);
  id = node.addPlayer(pipe, 'acc');
  nodeRef = node;
  const me = node.world.entities.find((e) => e.id === id)!;
  mobs.stats.set(MOB, { defense: 40, realm: 1, element: 'moc', dropSource: 'field', hpMax: 5000 });
  node.world = spawnEntity(node.world, { id: MOB, i: me.i + 2, j: me.j, hp: 5000, mpMax: 0 });
  const events: CombatEvent[] = [];
  const tick = (n = 1): void => {
    for (let k = 0; k < n; k++) {
      node.tick();
      clock += NETWORK.TICK_MS;
      sc.setPlayerPos({ i: me.i, j: me.j });
      events.push(...sc.update(clock));
    }
  };
  return { node, sc, pipe, id, me, tick, events, mobs, now: () => clock };
}

describe('server combat end to end (WorldNode <-> ServerCombat over the wire)', () => {
  it('own vitals arrive in the snapshot self block, enemies from aoi_enter and hpPct', () => {
    const t = setup();
    t.tick(30);
    const p = makeProfile('kiem');
    expect(t.sc.player).toMatchObject({
      hp: p.stats.hp,
      hpMax: p.stats.hp,
      mp: p.stats.mp,
      mpMax: p.stats.mp,
      shield: 0,
    });
    const mob = t.sc.enemy(MOB)!;
    expect(mob).toMatchObject({ hpMax: 5000, hp: 5000, alive: true });
    expect(mob.pos.i).toBeCloseTo(t.me.i + 2, 1);
  });

  it('a cast goes out with the wire id, the server resolves it, and hits / cooldown / MP come back to the HUD model', () => {
    const t = setup();
    t.tick(30);
    const slot = t.sc.hotbar.slots.findIndex((s) => s.skill.id === 'kiem_khi_tram');
    t.sc.setAim({ i: t.me.i + 3, j: t.me.j }); // the cone points east, where the mob stands
    const ev = t.sc.cast(slot, t.now());
    expect(ev[0]).toMatchObject({ type: 'cast_start', slot, castMs: 400 });
    expect(wireSkillIds().get('kiem_khi_tram')).toBeDefined();
    t.tick(3); // the sim spends the MP when it accepts the cast; regeneration (D87) only runs every 5th tick
    const mpAfterCast = t.sc.player.mp;
    t.tick(17); // 400 ms cast + a snapshot or two
    expect(t.pipe.results).toBe(1);
    const dmg = t.events.filter((e) => e.type === 'damage');
    expect(dmg).toHaveLength(1);
    expect(dmg[0]).toMatchObject({ targetId: MOB });
    const serverHp = t.node.world.entities.find((e) => e.id === MOB)!.hp;
    expect(serverHp).toBeLessThan(5000);
    // the HUD model follows the server: hpPct from snapshots, MP spent, cooldown synced
    expect(t.sc.enemy(MOB)!.hp).toBe(Math.round((Math.round((serverHp / 5000) * 100) / 100) * 5000));
    expect(mpAfterCast).toBeLessThan(makeProfile('kiem').stats.mp);
    expect(t.sc.hotbar.cooldownRemainingMs(slot, t.now())).toBeGreaterThan(1000);
    expect(t.events.some((e) => e.type === 'cast_done')).toBe(true);
  });

  it('a second cast during the cooldown is refused locally (no packet), and one the server refuses comes back as blocked', () => {
    const t = setup();
    t.tick(30);
    const slot = t.sc.hotbar.slots.findIndex((s) => s.skill.id === 'kiem_khi_tram');
    t.sc.cast(slot, t.now());
    t.tick(20);
    const before = t.pipe.results;
    expect(t.sc.cast(slot, t.now())[0]).toMatchObject({ type: 'blocked', reason: 'cooldown' });
    t.tick(2);
    expect(t.pipe.results).toBe(before); // nothing was sent
    // desync the local cooldown on purpose (as if the client clock drifted): the server still refuses
    t.sc.hotbar.reset();
    t.sc.cast(slot, t.now());
    t.tick(2);
    expect(t.events.some((e) => e.type === 'blocked' && e.reason === 'cooldown')).toBe(true);
    expect(t.sc.hotbar.cooldownRemainingMs(slot, t.now())).toBeGreaterThan(0); // the server's number won
  });

  it('a kill removes the enemy from the HUD model and the player vitals change on damage', () => {
    const t = setup();
    t.tick(30);
    t.node.world = {
      ...t.node.world,
      entities: t.node.world.entities.map((e) => (e.id === MOB ? { ...e, hp: 1 } : e)),
    };
    const slot = t.sc.hotbar.slots.findIndex((s) => s.skill.id === 'kiem_khi_tram');
    t.sc.setAim({ i: t.me.i + 3, j: t.me.j });
    t.sc.cast(slot, t.now());
    t.tick(20);
    expect(t.mobs.killed).toEqual([MOB]);
    expect(t.events.some((e) => e.type === 'death' && e.id === MOB)).toBe(true);
    // damage the player through the combat core: the next snapshot carries the new HP
    const hit = t.node.combat!.damagePlayer(t.node.world, t.id, 123, MOB);
    t.node.world = hit.world;
    t.tick(6);
    expect(t.sc.player.hp).toBe(makeProfile('kiem').stats.hp - 123);
  });
});
