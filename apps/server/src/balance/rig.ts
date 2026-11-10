/**
 * Class-balance harness (D115): a headless fight on the REAL server code.
 *
 * A `WorldNode` (combat core, mob manager with its AI, mob attacks and telegraphs, regeneration, the sim anti-cheat and cast rules) runs on an open
 * map with exactly one mob of a chosen def (the spawn table is overridden) and one or more players of chosen classes at a chosen realm. A scripted
 * player (`rotation.ts`) sends real `skill_cast` frames through `node.receive`, one decision per tick, exactly what a client does. Time is sim time
 * only (`node.tick()` = 50 ms, the packet clock is the sim clock), randomness is the seeded streams of the node, so a fight is a pure function of
 * its inputs and runs the same everywhere.
 *
 * Measured from what the combat core reports (a wrapper around `CombatSystem.postStep` collects its events and results, nothing else is touched):
 * damage dealt per player, damage taken, heal and shield amounts, deaths, pill use. A heal / shield event carries no caster, so it is credited to
 * the casters whose heal / shield skill resolved in the same step (split evenly): exact when one support cast resolves per step, which is the norm.
 */
import {
  MOB_ID_BASE,
  NETWORK,
  mobDefByKey,
  mobRealmAt,
  skillDefinitions,
  type MobDef,
  type PathId,
  type SkillDef,
  type SkillDefinitions,
} from '@vgtd/shared';
import { ErrorCode, encode, quantizePos } from '@vgtd/protocol';
import { TileGrid, compileSkills, type EntityState } from '@vgtd/sim';
import { WorldNode, type ClientTransport } from '../world/node.js';
import { MobManager } from '../world/mobs/index.js';
import type { CombatEvent, CombatResult } from '../world/combat/index.js';
import { branchDefs, type BranchMode } from './defs.js';
import { Rotation } from './rotation.js';

export const MOB_ID = MOB_ID_BASE;
const MAP = 64;
const CENTRE = MAP / 2;
/** the mob lives in this rectangle; its tier band is a fraction of its half-size around the centre */
const ZONE = { i0: 12, j0: 12, i1: 52, j1: 52 };

export interface PlayerSpec {
  path: PathId;
  mode: BranchMode;
}
export interface FightSpec {
  /** mob def key (docs/10 §4) */
  mob: string;
  /** node seed: also the seed of the mob's level draw (use `pickSeeds` to land in a realm) */
  seed: number;
  /** realm / sub-stage of every player (default: the realm and sub-stage the mob's level falls in: an even match) */
  realm?: number;
  subStage?: number;
  players: PlayerSpec[];
  /** give up after this much sim time (s) */
  limitS: number;
  /** stop at the first player death (solo survivability fights); default false = play on (parties) */
  stopOnDeath?: boolean;
  /** pills per player (D90: heal pill 18 %, shared 8 s cooldown); default 3 as in the design simulation */
  pills?: number;
}

export interface PlayerStats {
  path: PathId;
  mode: BranchMode;
  damage: number;
  taken: number;
  heal: number;
  shield: number;
  casts: number;
  deaths: number;
  pills: number;
  /** MP left at the end, 0..1 */
  mpLeft: number;
  /** min HP fraction seen */
  minHp: number;
  /** max HP of the player (the realm curve: the server applies no class weight) */
  hpMax: number;
}
export interface FightResult {
  killed: boolean;
  /** sim seconds until the mob died (null when it did not) */
  ttkS: number | null;
  /** sim seconds of the whole fight (kill, death or the limit) */
  timeS: number;
  /** seconds until the first player death (null when nobody died) */
  firstDeathS: number | null;
  mobLevel: number;
  mobHpMax: number;
  /** HP the mob still had at the end, 0..1 */
  mobHpLeft: number;
  realm: number;
  subStage: number;
  players: PlayerStats[];
  /** total damage the mob dealt */
  mobDamage: number;
}

class NullTransport implements ClientTransport {
  closed: { code: ErrorCode; text: string } | null = null;
  send(): void {
    /* the harness reads the combat core, not the wire */
  }
  close(code: ErrorCode, text: string): void {
    this.closed = { code, text };
  }
  buffered(): number {
    return 0;
  }
}

const tableFor = (def: MobDef) => [{ zone: def.zone, groups: [{ def: def.key, count: 1, pack: 1 }] }];

/** Level a node seed gives the mob of `def` (the mob manager draws it from the same seed): cheap, no world is built. */
export function mobLevelFor(def: MobDef, seed: number): number {
  const m = new MobManager({
    seed,
    zones: [{ zone: def.zone, ...ZONE }],
    grid: TileGrid.fromRows(Array.from({ length: MAP }, () => '.'.repeat(MAP))),
    tables: tableFor(def),
    center: { i: CENTRE, j: CENTRE },
  });
  return m.info(MOB_ID)!.level;
}

/** The first `count` seeds (from 1) whose mob level falls in `realm`: every class is measured against the same mobs. */
export function pickSeeds(mobKey: string, realm: number, count: number): number[] {
  const def = mobDefByKey(mobKey);
  if (!def) throw new Error(`unknown mob ${mobKey}`);
  const out: number[] = [];
  for (let s = 1; s < 5000 && out.length < count; s++) if (mobRealmAt(mobLevelFor(def, s)).realm === realm) out.push(s);
  if (out.length < count) throw new Error(`mob ${mobKey} has no level in realm ${realm}`);
  return out;
}

export function runFight(spec: FightSpec, base: SkillDefinitions = skillDefinitions): FightResult {
  const def = mobDefByKey(spec.mob);
  if (!def) throw new Error(`unknown mob ${spec.mob}`);
  // one definition set per fight: each player's class gets its branch applied (a class appears once per set; a party of different classes
  // composes them, two players of one class with different branches are not supported)
  let defs = base;
  for (const p of spec.players) defs = branchDefs(p.path, p.mode, defs);
  const skills = compileSkills(defs);
  const clock = { node: null as WorldNode | null };
  const node: WorldNode = new WorldNode({
    seed: spec.seed,
    mapTiles: MAP,
    spawn: { i0: CENTRE - 2, j0: CENTRE - 2, side: 4 },
    skills,
    combat: { defs, seed: spec.seed },
    mobs: { zones: [{ zone: def.zone, ...ZONE }], tables: tableFor(def), center: { i: CENTRE, j: CENTRE } },
    packetClock: () => clock.node!.world.timeMs,
  });
  clock.node = node;
  const combat = node.combat!;
  const mobInfo = node.mobs!.info(MOB_ID)!;
  const lvRealm = mobRealmAt(mobInfo.level);
  const realm = spec.realm ?? lvRealm.realm;
  const subStage = spec.subStage ?? lvRealm.subStage;

  // players, level with the mob's realm, standing close to it (inside every aggro radius) in a small arc
  const ids: number[] = [];
  const rot = new Map<number, Rotation>();
  spec.players.forEach((p, k) => {
    const id = node.addPlayer(new NullTransport(), `bal${k}`, p.path);
    ids.push(id);
    node.world = combat.setRealm(node.world, id, realm, subStage);
    const ang = Math.PI + (k - (spec.players.length - 1) / 2) * 0.5;
    const at = { i: mobInfo.home.i + Math.cos(ang) * 2.2, j: mobInfo.home.j + Math.sin(ang) * 2.2 };
    node.world = {
      ...node.world,
      entities: node.world.entities.map((e) => (e.id === id ? { ...e, i: at.i, j: at.j, mp: e.mpMax } : e)),
    };
    rot.set(id, new Rotation(id, p.path, defs, skills));
  });

  // collect what the combat core reports
  const stats: PlayerStats[] = spec.players.map((p) => ({
    path: p.path,
    mode: p.mode,
    damage: 0,
    taken: 0,
    heal: 0,
    shield: 0,
    casts: 0,
    deaths: 0,
    pills: 0,
    mpLeft: 1,
    minHp: 1,
    hpMax: 0,
  }));
  const idx = new Map(ids.map((id, k) => [id, k]));
  let mobDamage = 0;
  let firstDeath: number | null = null;
  const orig = combat.postStep.bind(combat);
  (combat as unknown as { postStep: typeof combat.postStep }).postStep = (w, ev) => {
    const r = orig(w, ev);
    onStep(r.events, r.results);
    return r;
  };
  // damage on a player (mob attacks, poison) goes through `damagePlayer`, also when `postStep` itself calls it: that is the one place it is read,
  // `postStep` events about players' damage are skipped below so nothing is counted twice
  const origHit = combat.damagePlayer.bind(combat);
  (combat as unknown as { damagePlayer: typeof combat.damagePlayer }).damagePlayer = (w, id, amount, sourceId) => {
    const r = origHit(w, id, amount, sourceId);
    onStep(r.events, [], true);
    return r;
  };
  const supportKeys = new Set(
    defs.skills.filter((s) => s.effects.some((e) => e.type === 'heal' || e.type === 'shield')).map((s) => s.id),
  );
  const keyOfWire = new Map(skills.map((s) => [s.id, s.key]));
  function onStep(events: readonly CombatEvent[], results: readonly CombatResult[], fromHit = false): void {
    const casters = results
      .filter((r) => r.reason === 0 && supportKeys.has(keyOfWire.get(r.skillId) ?? ''))
      .map((r) => r.entityId);
    for (const r of results) {
      const k = idx.get(r.entityId);
      if (k !== undefined && r.reason === 0) stats[k]!.casts++;
    }
    for (const e of events) {
      if (e.type === 'damage') {
        const src = idx.get(e.sourceId);
        const dst = idx.get(e.targetId);
        if (src !== undefined && e.targetId === MOB_ID) stats[src]!.damage += e.amount;
        if (dst !== undefined && fromHit && e.sourceId >= MOB_ID_BASE) {
          stats[dst]!.taken += e.amount;
          mobDamage += e.amount;
        }
      } else if (e.type === 'heal' || e.type === 'shield') {
        const who = casters.filter((c) => idx.has(c));
        if (who.length === 0) continue;
        for (const c of who) stats[idx.get(c)!]![e.type === 'heal' ? 'heal' : 'shield'] += e.amount / who.length;
      } else if (e.type === 'death' && fromHit) {
        const k = idx.get(e.id);
        if (k !== undefined) {
          stats[k]!.deaths++;
          if (firstDeath === null) firstDeath = node.world.timeMs / 1000;
        }
      }
    }
  }

  const ticks = Math.ceil((spec.limitS * 1000) / NETWORK.TICK_MS);
  let killedAt: number | null = null;
  let t = 0;
  for (; t < ticks; t++) {
    const ents = new Map<number, EntityState>(node.world.entities.map((e) => [e.id, e]));
    const mob = ents.get(MOB_ID);
    if (!mob) {
      killedAt = node.world.timeMs / 1000;
      break;
    }
    for (const id of ids) {
      const me = ents.get(id);
      if (!me || !combat.isAlive(id)) continue;
      const k = idx.get(id)!;
      const hpMax = combat.maxHpOf(id) ?? 1;
      stats[k]!.minHp = Math.min(stats[k]!.minHp, me.hp / hpMax);
      stats[k]!.mpLeft = me.mpMax > 0 ? me.mp / me.mpMax : 1;
      // the universal pill (D90): below 40 % HP, 3 charges, shared 8 s cooldown, through the combat core
      if (me.hp / hpMax < 0.4 && stats[k]!.pills < (spec.pills ?? 3)) {
        const r = combat.usePill(node.world, id);
        if (r.result === 'ok') {
          node.world = r.world;
          stats[k]!.pills++;
        }
      }
      const allies = ids
        .filter((a) => combat.isAlive(a))
        .map((a) => ({ id: a, hpPct: (ents.get(a)?.hp ?? 0) / (combat.maxHpOf(a) ?? 1) }));
      const cast = rot.get(id)!.next(node.world.timeMs, me, mob, allies, MOB_ID);
      if (cast) node.receive(id, encode(cast));
    }
    node.tick();
    if (spec.stopOnDeath && firstDeath !== null) {
      t++;
      break;
    }
    if (ids.every((id) => !combat.isAlive(id))) {
      t++;
      break;
    }
  }
  ids.forEach((id, k) => (stats[k]!.hpMax = combat.maxHpOf(id) ?? 0));
  const mobEnt = node.world.entities.find((e) => e.id === MOB_ID);
  const mobHpMax = mobInfo.maxHp;
  return {
    killed: killedAt !== null,
    ttkS: killedAt,
    timeS: (t * NETWORK.TICK_MS) / 1000,
    firstDeathS: firstDeath,
    mobLevel: mobInfo.level,
    mobHpMax,
    mobHpLeft: mobEnt ? Math.max(0, mobEnt.hp / mobHpMax) : 0,
    realm,
    subStage,
    players: stats,
    mobDamage,
  };
}

export { quantizePos };
export type { SkillDef };
