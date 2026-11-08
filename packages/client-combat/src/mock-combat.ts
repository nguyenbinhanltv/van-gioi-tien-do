/**
 * Offline mock combat loop (P3 client groundwork). Lets the combat HUD run before server combat exists.
 *
 * It is NOT the combat rules: damage, crit, MP regeneration, enemy attack and respawn numbers below are placeholders
 * (the `MOCK` table) so the HUD has something to show; real resolution is server-authoritative (docs/08, docs/11). It only
 * reads the skill kit (D49) for what the HUD must reflect: cast time, cooldown, GCD, MP cost, targeting mode and range, and
 * damage / heal / shield effects. Buffs, debuffs, CC, dashes and summons are ignored.
 *
 * Deterministic: time comes from the caller (`nowMs`), randomness from the injected `rand` (no Math.random / Date.now).
 */
import { skillDefinitions, statsAt } from '@vgtd/shared';
import type { PathId, SkillDef, SkillDefinitions, SkillEffect } from '@vgtd/shared';
import { Hotbar } from './hotbar.js';
import type { CastBlock } from './hotbar.js';
import { TargetSelector } from './targeting.js';
import type { Targetable, TilePoint } from './targeting.js';

export const PLAYER_ID = 0;

/** MOCK tunables (placeholders, not balance, not spec). */
export const MOCK = {
  /** Realm / sub-stage whose shared stats the mock player uses (Luyện Khí 1). */
  REALM: 1,
  SUBSTAGE: 1,
  CRIT_CHANCE: 0.1,
  CRIT_MULT: 1.5,
  /** Damage roll is `coeff * atk * (1 - SPREAD .. 1 + SPREAD)`. */
  SPREAD: 0.1,
  MP_REGEN_PCT_PER_S: 0.02,
  /** A "mộc nhân" dummy has this many player-ATK worth of HP. */
  DUMMY_HP_IN_ATK: 40,
  /** A hostile dummy hits the player for this share of max HP every ENEMY_ATTACK_MS. */
  ENEMY_HIT_PCT: 0.04,
  ENEMY_ATTACK_MS: 2000,
  ENEMY_ATTACK_RANGE: 2,
  RESPAWN_MS: 5000,
} as const;

export interface MockEnemySpec {
  name: string;
  pos: TilePoint;
  /** Fights back (a hostile dummy). Default false: a stationary "mộc nhân". */
  fightsBack?: boolean;
  /** Max HP, default `MOCK.DUMMY_HP_IN_ATK * player ATK`. */
  hpMax?: number;
}

export interface MockEnemy extends Targetable {
  name: string;
  hp: number;
  hpMax: number;
  fightsBack: boolean;
  nextAttackAt: number;
  respawnAt: number;
  readonly home: TilePoint;
}

export interface MockPlayer extends Targetable {
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  shield: number;
  /** Slot being cast and the time its effects land. */
  casting: { slot: number; endsAt: number; startedAt: number } | null;
}

export type CombatEvent =
  | { type: 'damage'; targetId: number; amount: number; crit: boolean; sourceId: number; atMs: number }
  | { type: 'heal'; targetId: number; amount: number; atMs: number }
  | { type: 'shield'; targetId: number; amount: number; atMs: number }
  | { type: 'cast_start'; slot: number; castMs: number; atMs: number }
  | { type: 'cast_done'; slot: number; atMs: number }
  | { type: 'blocked'; slot: number; reason: CastBlock; atMs: number }
  | { type: 'death'; id: number; atMs: number }
  | { type: 'respawn'; id: number; atMs: number };

export interface MockCombatOptions {
  path: PathId;
  enemies: MockEnemySpec[];
  /** Uniform [0, 1) source; inject a seeded generator. */
  rand: () => number;
  playerPos?: TilePoint;
  defs?: SkillDefinitions;
}

interface Hit {
  amount: number;
  crit: boolean;
}

const dist = (a: TilePoint, b: TilePoint): number => Math.hypot(a.i - b.i, a.j - b.j);

export class MockCombat {
  readonly hotbar: Hotbar;
  readonly target = new TargetSelector();
  readonly player: MockPlayer;
  readonly enemies: MockEnemy[];
  private readonly atk: number;
  private readonly rand: () => number;
  private lastTick = 0;
  private respawnPlayerAt = 0;

  constructor(opts: MockCombatOptions) {
    const defs = opts.defs ?? skillDefinitions;
    this.hotbar = new Hotbar(opts.path, defs);
    this.rand = opts.rand;
    const st = statsAt(MOCK.REALM, MOCK.SUBSTAGE);
    this.atk = st.atk;
    this.player = {
      id: PLAYER_ID,
      pos: { ...(opts.playerPos ?? { i: 0, j: 0 }) },
      alive: true,
      hostile: false,
      hp: st.hp,
      hpMax: st.hp,
      mp: st.mp,
      mpMax: st.mp,
      shield: 0,
      casting: null,
    };
    this.enemies = opts.enemies.map((e, n) => {
      const hpMax = e.hpMax ?? MOCK.DUMMY_HP_IN_ATK * st.atk;
      return {
        id: n + 1,
        name: e.name,
        pos: { ...e.pos },
        home: { ...e.pos },
        alive: true,
        hostile: true,
        hp: hpMax,
        hpMax,
        fightsBack: e.fightsBack ?? false,
        nextAttackAt: 0,
        respawnAt: 0,
      };
    });
  }

  enemy(id: number): MockEnemy | undefined {
    return this.enemies.find((e) => e.id === id);
  }

  setPlayerPos(p: TilePoint): void {
    this.player.pos.i = p.i;
    this.player.pos.j = p.j;
  }

  /**
   * Try to cast a hotbar slot. Returns the resulting events (`cast_start` on success, `blocked` with the reason otherwise).
   * Checks, in order: slot/passive, player alive, busy casting, cooldown/GCD, MP, target (when the skill needs one), range.
   */
  cast(slot: number, nowMs: number): CombatEvent[] {
    const block = this.checkCast(slot, nowMs);
    if (block) return [{ type: 'blocked', slot, reason: block, atMs: nowMs }];
    const skill = this.hotbar.slot(slot)!.skill;
    this.player.mp -= this.mpCost(skill);
    this.hotbar.commit(slot, nowMs);
    const castMs = skill.timing.cast_ms + (skill.timing.channel_ms ?? 0);
    this.player.casting = { slot, startedAt: nowMs, endsAt: nowMs + castMs };
    const out: CombatEvent[] = [{ type: 'cast_start', slot, castMs, atMs: nowMs }];
    if (castMs <= 0) out.push(...this.resolveCast(nowMs));
    return out;
  }

  /** Why `slot` cannot be cast now (null = it can). Pure; does not spend anything. */
  checkCast(slot: number, nowMs: number): CastBlock | null {
    const s = this.hotbar.slot(slot);
    if (!s) return 'empty';
    if (!this.player.alive) return 'dead';
    if (!s.castable) return 'passive';
    if (this.player.casting) return 'busy';
    const cd = this.hotbar.blockedBy(slot, nowMs);
    if (cd) return cd;
    if (this.player.mp < this.mpCost(s.skill)) return 'mp';
    if (this.needsTarget(s.skill)) {
      const t = this.target.current === null ? undefined : this.enemy(this.target.current);
      if (!t || !t.alive) return 'no_target';
      if (dist(t.pos, this.player.pos) > (s.skill.targeting.range_tiles ?? 2)) return 'range';
    }
    return null;
  }

  /** Advance the loop to `nowMs`: land a finished cast, enemy attacks, MP regen, respawns. Returns the events produced. */
  update(nowMs: number): CombatEvent[] {
    const out: CombatEvent[] = [];
    const dtS = Math.max(0, (nowMs - this.lastTick) / 1000);
    this.lastTick = nowMs;
    const p = this.player;
    if (p.alive) {
      p.mp = Math.min(p.mpMax, p.mp + p.mpMax * MOCK.MP_REGEN_PCT_PER_S * dtS);
      if (p.casting && nowMs >= p.casting.endsAt) out.push(...this.resolveCast(nowMs));
    }
    for (const e of this.enemies) {
      if (!e.alive) {
        if (nowMs >= e.respawnAt) {
          e.alive = true;
          e.hp = e.hpMax;
          e.nextAttackAt = nowMs + MOCK.ENEMY_ATTACK_MS;
          out.push({ type: 'respawn', id: e.id, atMs: nowMs });
        }
        continue;
      }
      if (!e.fightsBack) continue;
      if (e.nextAttackAt === 0) e.nextAttackAt = nowMs + MOCK.ENEMY_ATTACK_MS;
      if (p.alive && nowMs >= e.nextAttackAt && dist(e.pos, p.pos) <= MOCK.ENEMY_ATTACK_RANGE) {
        e.nextAttackAt = nowMs + MOCK.ENEMY_ATTACK_MS;
        out.push(...this.hurtPlayer(Math.max(1, Math.round(p.hpMax * MOCK.ENEMY_HIT_PCT)), e.id, nowMs));
      }
    }
    if (!p.alive && nowMs >= this.respawnPlayerAt) {
      p.alive = true;
      p.hp = p.hpMax;
      p.mp = p.mpMax;
      p.shield = 0;
      p.casting = null;
      this.hotbar.reset();
      out.push({ type: 'respawn', id: PLAYER_ID, atMs: nowMs });
    }
    this.target.validate(this.enemies); // clears the selection when the target died; the HUD reads `target.current`
    return out;
  }

  private mpCost(skill: SkillDef): number {
    return Math.round((skill.cost?.mp_pct ?? 0) * this.player.mpMax);
  }

  private needsTarget(skill: SkillDef): boolean {
    const m = skill.targeting.mode;
    return m === 'enemy' || m === 'direction' || m === 'ground';
  }

  private scaleValue(e: SkillEffect, target?: MockEnemy): number {
    const sc = e.scale;
    if (!sc) return 0;
    switch (sc.stat) {
      case 'atk':
        return sc.coeff * this.atk;
      case 'hp_max':
        return sc.coeff * this.player.hpMax;
      case 'mp_max':
        return sc.coeff * this.player.mpMax;
      case 'target_hp_max':
        return sc.coeff * (target?.hpMax ?? 0);
      default:
        return 0; // def / agi scales are not simulated by the mock
    }
  }

  private roll(base: number): Hit {
    const crit = this.rand() < MOCK.CRIT_CHANCE;
    const spread = 1 + (this.rand() * 2 - 1) * MOCK.SPREAD;
    return { amount: Math.max(1, Math.round(base * spread * (crit ? MOCK.CRIT_MULT : 1))), crit };
  }

  private resolveCast(nowMs: number): CombatEvent[] {
    const p = this.player;
    const cast = p.casting;
    if (!cast) return [];
    p.casting = null;
    const skill = this.hotbar.slot(cast.slot)!.skill;
    const out: CombatEvent[] = [];
    const main = this.target.current === null ? undefined : this.enemy(this.target.current);
    for (const eff of skill.effects) {
      if (eff.type === 'damage' && eff.scale) {
        for (const v of this.victimsOf(skill, eff, main)) out.push(...this.hurtEnemy(v, this.rollHits(eff, v), nowMs));
      } else if (eff.type === 'heal' && eff.scale) {
        const amount = Math.round(this.scaleValue(eff) * (eff.hits ?? 1));
        const healed = Math.max(0, Math.min(amount, p.hpMax - p.hp));
        p.hp += healed;
        out.push({ type: 'heal', targetId: PLAYER_ID, amount: healed, atMs: nowMs });
      } else if (eff.type === 'shield' && eff.scale) {
        const amount = Math.round(this.scaleValue(eff));
        p.shield += amount;
        out.push({ type: 'shield', targetId: PLAYER_ID, amount, atMs: nowMs });
      }
    }
    out.push({ type: 'cast_done', slot: cast.slot, atMs: nowMs });
    return out;
  }

  private rollHits(eff: SkillEffect, victim: MockEnemy): Hit[] {
    const hits = Math.max(1, eff.hits ?? 1);
    const out: Hit[] = [];
    for (let h = 0; h < hits; h++) out.push(this.roll(this.scaleValue(eff, victim)));
    return out;
  }

  /** The selected enemy plus, for effects with a `radius`, every other alive enemy within it of the target. */
  private victimsOf(skill: SkillDef, eff: SkillEffect, main: MockEnemy | undefined): MockEnemy[] {
    if (!main || !main.alive) return [];
    const radius = eff.radius ?? skill.shape.radius ?? 0;
    if (radius <= 0 || skill.shape.type === 'single') return [main];
    return this.enemies.filter((e) => e.alive && (e === main || dist(e.pos, main.pos) <= radius));
  }

  private hurtEnemy(e: MockEnemy, hits: Hit[], nowMs: number): CombatEvent[] {
    const out: CombatEvent[] = [];
    for (const h of hits) {
      if (!e.alive) break;
      e.hp = Math.max(0, e.hp - h.amount);
      out.push({ type: 'damage', targetId: e.id, amount: h.amount, crit: h.crit, sourceId: PLAYER_ID, atMs: nowMs });
      if (e.hp <= 0) {
        e.alive = false;
        e.respawnAt = nowMs + MOCK.RESPAWN_MS;
        out.push({ type: 'death', id: e.id, atMs: nowMs });
      }
    }
    return out;
  }

  private hurtPlayer(amount: number, sourceId: number, nowMs: number): CombatEvent[] {
    const p = this.player;
    const out: CombatEvent[] = [];
    const absorbed = Math.min(p.shield, amount);
    p.shield -= absorbed;
    p.hp = Math.max(0, p.hp - (amount - absorbed));
    out.push({ type: 'damage', targetId: PLAYER_ID, amount, crit: false, sourceId, atMs: nowMs });
    if (p.hp <= 0) {
      p.alive = false;
      p.casting = null;
      this.respawnPlayerAt = nowMs + MOCK.RESPAWN_MS;
      out.push({ type: 'death', id: PLAYER_ID, atMs: nowMs });
    }
    return out;
  }
}
