/**
 * Class-kit balance simulation (D49, docs/11 §4.5): solo dummy DPS, solo pack-clear and group boss fights.
 *
 * Deterministic: fixed 20 Hz tick (`NETWORK.TICK_MS`), seeded PRNG (mulberry32), no wall clock, expected-value crit and
 * no damage jitter. All damage goes through `computeDamage` (docs/07 §4); shapes are tested on the logic tile grid with
 * the 0.45-tile hurtbox. Player AI is a generic greedy rotation driven only by the skill data, never by skill ids.
 * Simplifications (documented in docs/11 §4.5): neutral Ngũ hành, rank 1, matching Linh căn, expected crit, mobs form a
 * half-ring around the target, elemental riders and the Phù lục item cost are not simulated.
 * Every tuning constant here is "Đề xuất – chờ duyệt".
 */
import { HURTBOX_RADIUS_TILES, NETWORK } from '../constants.js';
import { CRIT_DEFAULT, PEN_MAX, computeDamage } from './combat.js';
import { clamp } from './breakthrough.js';
import { statsAtX } from './stats.js';
import {
  HARD_CC,
  type BranchDef,
  type ClassDef,
  type PathId,
  type SkillDef,
  type SkillDefinitions,
  type SkillEffect,
  type StatusId,
  branchOf,
  classOf,
  effectActive,
  equivalentHits,
  skillDefinitions,
  skillsOf,
} from './skills.js';

export const SIM = {
  TICK_MS: NETWORK.TICK_MS,
  /** Stage used for stats: Kim Đan sơ kỳ (x = 2). Ratios (not absolutes) matter for balance. */
  STAGE_X: 2,
  BASE_CRIT: 0.05,
  MOVE_SPEED_TILES_PER_S: 5,
  MP_REGEN_COMBAT_PCT_PER_S: 0.01,
  MP_PER_BASIC_HIT_PCT: 0.005,
  /** Universal sustain (đan dược): identical for every class, shared 8 s cooldown. */
  PILL: { heal_pct: 0.18, cooldown_ms: 8000, charges: 3, use_below_hp_pct: 0.4 },
  DR_CAP: 0.75,
  /** Mark detonation splash on neighbours, as a fraction of the main hit (per stack). */
  MARK_SPLASH: 0.6,
  /** Standard mob pack (solo pack-clear). */
  MOB: {
    count: 6,
    hp_pct: 1.0,
    atk_pct: 1.0,
    def_pct: 1.0,
    speed: 2.8,
    atk_interval_ms: 2400,
    melee_reach: 1.4,
    spawn_dist: 10,
    spawn_spread: 2.2,
    ring_radius: 1.0,
    half_ring_deg: 140,
    radius: HURTBOX_RADIUS_TILES,
  },
  /** Dummy fight used for the "x basic attack" DPS multiplier of docs/11 §4.5. */
  DUMMY: { duration_ms: 120_000, hp: 1e12, def_pct: 1.0 },
  /** Group boss. Every mechanic is solvable by any hard CC / interrupt (D49 principle 5). */
  BOSS: {
    hp_mult: 30,
    def_pct: 1.4,
    atk_pct: 1.25,
    radius: 1.2,
    auto_interval_ms: 1600,
    auto_coeff: 0.8,
    cleave_every_ms: 9000,
    cleave_telegraph_ms: 1500,
    cleave_radius: 3.5,
    cleave_coeff: 1.4,
    nuke_every_ms: 25_000,
    nuke_cast_ms: 3000,
    nuke_coeff: 2.2,
    stagger_ms: 2000,
    stagger_dmg_mult: 1.2,
    enrage_ms: 300_000,
    enrage_mult: 3,
    slow_effect_mult: 0.5,
    melee_stand: 1.8,
    ranged_stand: 6,
  },
  /** Team-value exchange rate: 1 HP prevented/restored for others ≈ this many damage points. */
  ETD_W: 0.5,
  /** Seeds cycle through these mob-strength multipliers so the death rate varies smoothly with class robustness. */
  PACK_STRENGTHS: [0.9, 1.0, 1.1, 1.2, 1.3],
  SOLO_PACK_LIMIT_MS: 120_000,
  BOSS_LIMIT_MS: 400_000,
} as const;

// ------------------------------------------------------------------ PRNG
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ types
interface V {
  x: number;
  y: number;
}
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);
interface Buff {
  stat: string;
  mag: number;
  until: number;
  src: number;
}
interface Shield {
  amt: number;
  until: number;
  src: number;
  explode?: { coeff: number; radius: number };
}
interface Dot {
  src: number;
  perTick: number;
  interval: number;
  nextAt: number;
  until: number;
}
interface Zone extends V {
  src: number;
  perTick: number;
  interval: number;
  nextAt: number;
  until: number;
  radius: number;
}
interface Aim {
  dir: number;
  x: number;
  y: number;
  enemy?: Enemy;
  ally?: Player;
  hits: number;
}
interface Cast {
  skill: SkillDef;
  resolveAt: number;
  ticks: number[];
  tickIdx: number;
  aim: Aim;
  resolved: boolean;
  mpSpent: number;
  grouped: boolean;
}
export interface PlayerCounters {
  damage: number;
  petDamage: number;
  buffExtra: number;
  healOthers: number;
  healSelf: number;
  shieldOthers: number;
  shieldSelf: number;
  drOthers: number;
  soak: number;
  taken: number;
  lifesteal: number;
  pills: number;
  casts: number;
  mpSpent: number;
  deaths: number;
  /** boss casts (Đại Chiêu) this player interrupted */
  interrupts: number;
  /** casts per skill id (rotation breakdown) */
  bySkill: Record<string, number>;
}
const newCounters = (): PlayerCounters => ({
  damage: 0,
  petDamage: 0,
  buffExtra: 0,
  healOthers: 0,
  healSelf: 0,
  shieldOthers: 0,
  shieldSelf: 0,
  drOthers: 0,
  soak: 0,
  taken: 0,
  lifesteal: 0,
  pills: 0,
  casts: 0,
  mpSpent: 0,
  deaths: 0,
  interrupts: 0,
  bySkill: {},
});

class Player implements V {
  x = 0;
  y = 0;
  hp: number;
  mp: number;
  alive = true;
  readonly cd = new Map<string, number>();
  busyUntil = 0;
  nextBasicAt = 0;
  basicIdx = 0;
  cast: Cast | null = null;
  buffs: Buff[] = [];
  shields: Shield[] = [];
  stunUntil = 0;
  rootUntil = 0;
  slowUntil = 0;
  slowMag = 0;
  invulnUntil = 0;
  pills: number;
  pillReadyAt = 0;
  stacks = 0;
  stacksUntil = 0;
  lastTakenStackAt = -1e9;
  petNextAt = 0;
  readonly passive: Record<string, number> = {};
  petCoeff = 0;
  petInterval = 1200;
  readonly skills: SkillDef[];
  readonly c = newCounters();
  readonly hpMax: number;
  readonly mpMax: number;
  readonly atk: number;
  readonly defBase: number;
  constructor(
    readonly id: number,
    readonly cls: ClassDef,
    readonly branch: BranchDef,
    defs: SkillDefinitions,
    pills: number,
  ) {
    const b = statsAtX(SIM.STAGE_X);
    const w = cls.stat_weights;
    this.hpMax = b.hp * w.hp;
    this.mpMax = b.mp * w.mp;
    this.atk = b.atk * w.atk;
    this.defBase = b.def * w.def;
    this.hp = this.hpMax;
    this.mp = this.mpMax;
    this.pills = pills;
    this.skills = skillsOf(cls.path, defs);
    for (const s of this.skills) {
      if (s.kind !== 'passive') continue;
      for (const e of s.effects) {
        if (e.type === 'passive_stat' && e.stat)
          this.passive[e.stat] = (this.passive[e.stat] ?? 0) + (e.magnitude ?? 0);
        if (e.type === 'summon') {
          this.petCoeff = e.scale?.coeff ?? 0;
          this.petInterval = e.tick_interval_ms ?? 1200;
        }
      }
    }
  }
}

class Enemy implements V {
  hp: number;
  alive = true;
  nextAtkAt = 0;
  stunUntil = 0;
  rootUntil = 0;
  slowUntil = 0;
  slowMag = 0;
  marks = new Map<string, { stacks: number; until: number }>();
  dots: Dot[] = [];
  shreds: { mag: number; until: number }[] = [];
  forced: { pid: number; until: number } | null = null;
  threat = new Map<number, number>();
  target = -1;
  angle = 0;
  staggerUntil = 0;
  constructor(
    readonly id: number,
    public x: number,
    public y: number,
    readonly hpMax: number,
    readonly atk: number,
    readonly def: number,
    readonly radius: number,
    readonly boss: boolean,
  ) {
    this.hp = hpMax;
  }
}

// ------------------------------------------------------------------ shapes
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}
/** Hit test of an enemy against a skill shape. `o` is the shape origin; the cone/line direction is `dir`. */
function inShape(s: SkillDef, o: V, dir: number, e: Enemy): boolean {
  const sh = s.shape;
  const r = e.radius;
  const d = Math.hypot(e.x - o.x, e.y - o.y);
  switch (sh.type) {
    case 'single':
      return true;
    case 'circle':
    case 'ring':
      return d <= (sh.radius ?? 0) + r;
    case 'cone': {
      if (d > (sh.radius ?? 0) + r) return false;
      if (d < 0.05) return true;
      return angleDiff(Math.atan2(e.y - o.y, e.x - o.x), dir) <= (((sh.angle_deg ?? 360) / 2) * Math.PI) / 180 + 0.001;
    }
    case 'line': {
      const dx = e.x - o.x;
      const dy = e.y - o.y;
      const along = dx * Math.cos(dir) + dy * Math.sin(dir);
      const perp = Math.abs(-dx * Math.sin(dir) + dy * Math.cos(dir));
      return along >= -r && along <= (sh.length ?? 0) + r && perp <= (sh.width ?? 0) / 2 + r;
    }
  }
}

// ------------------------------------------------------------------ world
export interface SimPlayerSpec {
  path: PathId;
  mode: 'solo' | 'team';
  /** optional override of the pill count (default 3) */
  pills?: number;
}
export type Scenario = 'pack' | 'dummy' | 'boss';
export interface WorldOpts {
  scenario: Scenario;
  players: SimPlayerSpec[];
  seed: number;
  defs?: SkillDefinitions;
  /** disable the Phù Linh pet (to report DPS "without pet") */
  noPet?: boolean;
  /** disable branch mods and patches (raw class kit) */
  noBranch?: boolean;
  /** disable pills */
  noPills?: boolean;
  /** multiplier on mob ATK (stress test; default 1) */
  mobAtkMult?: number;
  /** multiplier on boss damage (stress test; default 1) */
  bossDmgMult?: number;
}

class World {
  t = 0;
  readonly players: Player[] = [];
  readonly enemies: Enemy[] = [];
  readonly zones: Zone[] = [];
  readonly rand: () => number;
  readonly defs: SkillDefinitions;
  readonly gcd: number;
  // boss state
  bossNextCleave = 0;
  bossCleaveAt = -1;
  bossNextNuke = 0;
  bossNukeAt = -1;
  bossNextAuto = 0;
  bossDodged = new Set<number>();
  nukeClaim = -1;
  enraged = false;
  readonly scenario: Scenario;
  readonly opts: WorldOpts;

  constructor(opts: WorldOpts) {
    this.opts = opts;
    this.scenario = opts.scenario;
    this.defs = opts.defs ?? skillDefinitions;
    this.gcd = this.defs.global.gcd_ms ?? 800;
    this.rand = mulberry32(opts.seed);
    opts.players.forEach((spec, i) => {
      const cls = classOf(spec.path, this.defs);
      const br = branchOf(spec.mode === 'solo' ? cls.solo_branch : cls.team_branch, this.defs);
      const p = new Player(
        i,
        cls,
        opts.noBranch ? { ...br, stat_mods: {}, skill_patches: {} } : br,
        this.defs,
        opts.noPills ? 0 : (spec.pills ?? SIM.PILL.charges),
      );
      if (opts.noPet) p.petCoeff = 0;
      this.players.push(p);
    });
    this.spawn();
  }

  private spawn(): void {
    const b = statsAtX(SIM.STAGE_X);
    if (this.scenario === 'boss') {
      const B = SIM.BOSS;
      this.enemies.push(new Enemy(100, 0, 0, b.hp * B.hp_mult, b.atk * B.atk_pct, b.def * B.def_pct, B.radius, true));
      this.players.forEach((p, i) => {
        const melee = p.cls.basic_attack.range_tiles < 5;
        const r = melee ? B.melee_stand : B.ranged_stand;
        const a = (i / this.players.length) * 2 * Math.PI + 0.4;
        p.x = Math.cos(a) * r;
        p.y = Math.sin(a) * r;
      });
      this.bossNextCleave = B.cleave_every_ms;
      this.bossNextNuke = B.nuke_every_ms;
      this.bossNextAuto = B.auto_interval_ms;
      return;
    }
    const p0 = this.players[0]!;
    p0.x = 0;
    p0.y = 0;
    if (this.scenario === 'dummy') {
      this.enemies.push(new Enemy(100, 1.2, 0, SIM.DUMMY.hp, 0, b.def * SIM.DUMMY.def_pct, SIM.MOB.radius, false));
      return;
    }
    const M = SIM.MOB;
    for (let i = 0; i < M.count; i++) {
      const jx = (this.rand() - 0.5) * 2 * M.spawn_spread;
      const jy = (this.rand() - 0.5) * 2 * M.spawn_spread;
      const e = new Enemy(
        100 + i,
        M.spawn_dist + jx,
        jy,
        b.hp * M.hp_pct,
        b.atk * M.atk_pct * (this.opts.mobAtkMult ?? 1),
        b.def * M.def_pct,
        M.radius,
        false,
      );
      const spread = (M.half_ring_deg * Math.PI) / 180;
      e.angle = (i / (M.count - 1) - 0.5) * 2 * spread + (this.rand() - 0.5) * 0.2;
      e.nextAtkAt = 600 + Math.floor(this.rand() * 800);
      this.enemies.push(e);
    }
  }

  // ---------------------------------------------------------------- stats
  grouped(p: Player): boolean {
    return this.players.some((q) => q !== p && q.alive);
  }
  statSum(p: Player, stat: string): number {
    let v = p.passive[stat] ?? 0;
    for (const b of p.buffs) if (b.stat === stat && b.until > this.t) v += b.mag;
    return v;
  }
  private auraSum(p: Player, key: 'team_dmg' | 'team_dr' | 'ally_crit_bonus'): number {
    let v = 0;
    for (const q of this.players) if (q.alive) v += q.branch.stat_mods[key] ?? 0;
    return p.alive ? v : 0;
  }
  private traitMod(p: Player, key: 'dr_pct' | 'lifesteal' | 'dmg_pct'): number {
    const tr = p.cls.trait;
    if (!tr || p.stacks <= 0 || p.stacksUntil <= this.t) return 0;
    return (tr.per_stack[key] ?? 0) * p.stacks;
  }
  critChance(p: Player): number {
    return clamp(SIM.BASE_CRIT + this.statSum(p, 'crit_chance') + this.auraSum(p, 'ally_crit_bonus'), 0, 1);
  }
  private dmgMods(p: Player): { mult: number; parts: { src: number; pct: number }[] } {
    const parts: { src: number; pct: number }[] = [];
    let pct = this.traitMod(p, 'dmg_pct') + this.auraSum(p, 'team_dmg');
    for (const b of p.buffs)
      if (b.stat === 'dmg_pct' && b.until > this.t) {
        pct += b.mag;
        parts.push({ src: b.src, pct: b.mag });
      }
    pct += p.passive.dmg_pct ?? 0;
    if (p.hp < p.hpMax * 0.4) pct += p.passive.low_hp_dmg_pct ?? 0;
    return { mult: (1 + pct) * (p.branch.stat_mods.dmg_mult ?? 1), parts };
  }
  lifesteal(p: Player): number {
    return this.statSum(p, 'lifesteal') + this.traitMod(p, 'lifesteal') + (p.branch.stat_mods.lifesteal_add ?? 0);
  }
  defOf(p: Player): number {
    return p.defBase * Math.max(0.2, 1 + this.statSum(p, 'def_pct'));
  }
  private enemyDef(e: Enemy): number {
    let s = 0;
    for (const x of e.shreds) if (x.until > this.t) s += x.mag;
    return e.def * (1 - Math.min(0.5, s));
  }

  // ---------------------------------------------------------------- damage plumbing
  /** One player hit on an enemy. Returns damage dealt. */
  hit(p: Player, e: Enemy, coeff: number, pen = 0): number {
    if (!e.alive) return 0;
    const m = this.dmgMods(p);
    const crit = 1 + this.critChance(p) * (CRIT_DEFAULT - 1);
    const base = computeDamage({
      atk: p.atk,
      def: this.enemyDef(e),
      cSkill: coeff,
      pen: clamp(this.statSum(p, 'pen') + pen, 0, PEN_MAX),
    });
    let dmg = base * crit * m.mult * (this.t < e.staggerUntil ? SIM.BOSS.stagger_dmg_mult : 1);
    dmg = Math.min(dmg, e.hp);
    e.hp -= dmg;
    p.c.damage += dmg;
    // buff attribution: share of the damage owed to other players' buffs
    const total = m.parts.reduce((n, x) => n + x.pct, 0);
    if (total > 0) {
      const extra = dmg * (total / (1 + total + this.traitMod(p, 'dmg_pct') + this.auraSum(p, 'team_dmg')));
      for (const part of m.parts)
        if (part.src !== p.id) this.players[part.src]!.c.buffExtra += (extra * part.pct) / total;
    }
    const aura = this.auraSum(p, 'team_dmg');
    if (aura > 0 && this.players.length > 1) {
      for (const q of this.players)
        if (q.alive && q !== p && (q.branch.stat_mods.team_dmg ?? 0) > 0)
          q.c.buffExtra += (dmg * (q.branch.stat_mods.team_dmg ?? 0)) / (1 + aura + total);
    }
    // threat
    const tm = p.branch.stat_mods.threat_mult ?? 1;
    e.threat.set(p.id, (e.threat.get(p.id) ?? 0) + dmg * tm);
    const ls = this.lifesteal(p);
    if (ls > 0 && p.alive) this.healTo(p, p, dmg * ls, true);
    if (e.hp <= 0) e.alive = false;
    return dmg;
  }

  /** Heal `to` from `src`. Overheal optionally converts into a shield (ratio). Returns effective heal. */
  healTo(src: Player, to: Player, amount: number, isLifesteal = false, overhealToShield = 0, shieldMs = 6000): number {
    if (!to.alive) return 0;
    const missing = to.hpMax - to.hp;
    const eff = Math.min(amount, missing);
    to.hp += eff;
    if (isLifesteal) src.c.lifesteal += eff;
    else if (src === to) src.c.healSelf += eff;
    else src.c.healOthers += eff;
    const over = amount - eff;
    if (over > 0 && overhealToShield > 0) {
      const room = Math.max(0, to.hpMax * 0.3 - to.shields.reduce((n, s) => n + s.amt, 0));
      this.addShield(src, to, Math.min(over * overhealToShield, room), shieldMs, undefined);
    }
    return eff;
  }
  addShield(src: Player, to: Player, amt: number, ms: number, explode: Shield['explode']): void {
    if (amt <= 0 || !to.alive) return;
    to.shields.push({ amt, until: this.t + ms, src: src.id, explode });
  }
  private explodeShield(owner: Player, s: Shield): void {
    if (!s.explode) return;
    for (const e of this.enemies) {
      if (e.alive && dist(owner, e) <= s.explode.radius + e.radius) this.hit(this.players[s.src]!, e, s.explode.coeff);
    }
  }
  /** Raw hit on a player (after formula). Applies DR, shields, soak accounting. */
  hurt(p: Player, raw: number, e: Enemy | null, soakCredit = false): void {
    if (!p.alive || this.t < p.invulnUntil) return;
    let dr = this.statSum(p, 'dr_pct') + this.traitMod(p, 'dr_pct') + this.auraSum(p, 'team_dr');
    dr = clamp(dr, 0, SIM.DR_CAP);
    // DR credit to other players' buffs
    let dmg = raw * (1 - dr) * (p.branch.stat_mods.dmg_taken_mult ?? 1);
    for (const b of p.buffs)
      if (b.stat === 'dr_pct' && b.until > this.t && b.src !== p.id) this.players[b.src]!.c.drOthers += raw * b.mag;
    for (const q of this.players)
      if (q !== p && q.alive && (q.branch.stat_mods.team_dr ?? 0) > 0)
        q.c.drOthers += raw * (q.branch.stat_mods.team_dr ?? 0);
    if (e?.boss) dmg *= (this.enraged ? SIM.BOSS.enrage_mult : 1) * (this.opts.bossDmgMult ?? 1);
    p.c.taken += dmg;
    if (soakCredit) p.c.soak += dmg;
    for (let i = 0; i < p.shields.length && dmg > 0;) {
      const s = p.shields[i]!;
      const ab = Math.min(s.amt, dmg);
      if (s.src === p.id) this.players[s.src]!.c.shieldSelf += ab;
      else this.players[s.src]!.c.shieldOthers += ab;
      s.amt -= ab;
      dmg -= ab;
      if (s.amt <= 0) {
        p.shields.splice(i, 1);
        this.explodeShield(p, s);
      } else i++;
    }
    if (dmg > 0) p.hp -= dmg;
    // class trait: stack on hit taken
    const tr = p.cls.trait;
    if (tr && (tr.gain_on === 'hit_taken' || tr.gain_on === 'both') && this.t - p.lastTakenStackAt >= 500) {
      p.lastTakenStackAt = this.t;
      this.gainStack(p);
    }
    if (p.hp <= 0) this.die(p);
  }
  private die(p: Player): void {
    p.alive = false;
    p.hp = 0;
    p.c.deaths++;
    p.cast = null;
    p.buffs = [];
    p.shields = [];
  }
  gainStack(p: Player): void {
    const tr = p.cls.trait;
    if (!tr) return;
    if (p.stacksUntil <= this.t) p.stacks = 0;
    p.stacks = Math.min(tr.max_stacks, p.stacks + 1);
    p.stacksUntil = this.t + tr.duration_ms;
  }

  // ---------------------------------------------------------------- status
  applyStatus(src: Player, e: Enemy, id: StatusId, ms: number, mag: number): void {
    if (!e.alive) return;
    const hard = HARD_CC.includes(id);
    if (e.boss) {
      if (hard) {
        this.interruptBoss(src, e);
        return;
      }
      if (id === 'slow') {
        e.slowUntil = this.t + ms;
        e.slowMag = mag * SIM.BOSS.slow_effect_mult;
      }
      return;
    }
    if (id === 'stun' || id === 'freeze' || id === 'knockup') e.stunUntil = Math.max(e.stunUntil, this.t + ms);
    else if (id === 'root') e.rootUntil = Math.max(e.rootUntil, this.t + ms);
    else if (id === 'slow') {
      e.slowUntil = this.t + ms;
      e.slowMag = mag;
    }
    void src;
  }
  private interruptBoss(src: Player, e: Enemy): void {
    if (this.bossNukeAt >= 0) {
      src.c.interrupts++;
      this.bossNukeAt = -1;
      this.bossNextNuke = this.t + SIM.BOSS.nuke_every_ms;
      e.staggerUntil = this.t + SIM.BOSS.stagger_ms;
    }
  }

  // ---------------------------------------------------------------- targeting
  private nearestEnemy(p: V): Enemy | null {
    let best: Enemy | null = null;
    let bd = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = dist(p, e) - e.radius;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }
  private hitsFor(s: SkillDef, o: V, dir: number): Enemy[] {
    const out: Enemy[] = [];
    for (const e of this.enemies) if (e.alive && inShape(s, o, dir, e)) out.push(e);
    out.sort((a, b) => dist(o, a) - dist(o, b));
    return out.slice(0, this.defs.global.max_targets_per_cast ?? 12);
  }
  /** Best aim for a skill, or null when it cannot do anything useful. */
  private isInterrupt(s: SkillDef, grouped: boolean): boolean {
    return this.activeEffects(s, grouped).some(
      (e) =>
        e.type === 'knockback' ||
        (e.type === 'status' && e.status_id !== undefined && (HARD_CC as readonly string[]).includes(e.status_id)),
    );
  }
  private aimFor(p: Player, s: SkillDef): Aim | null {
    const tg = s.targeting;
    const range = tg.range_tiles ?? 0;
    const a: Aim = { dir: 0, x: p.x, y: p.y, hits: 0 };
    const hasEnemyEffect = s.effects.some((e) =>
      ['damage', 'dot', 'status', 'mark', 'debuff', 'knockback', 'pull', 'taunt', 'detonate'].includes(e.type),
    );
    if (tg.mode === 'self') {
      a.hits = s.shape.type === 'single' ? 0 : this.hitsFor(s, p, 0).length;
      if (s.shape.type !== 'single' && a.hits === 0 && s.effects.some((e) => e.type === 'damage')) return null;
      if (
        hasEnemyEffect &&
        s.shape.type !== 'single' &&
        a.hits === 0 &&
        s.effects.every((e) => !['buff', 'shield', 'heal'].includes(e.type))
      )
        return null;
      return a;
    }
    if (tg.mode === 'ally_or_self') {
      a.ally = this.pickAlly(p, s) ?? p;
      return a;
    }
    const near = this.nearestEnemy(p);
    if (!near) return null;
    if (tg.mode === 'enemy' || tg.mode === 'auto_nearest_enemy') {
      if (dist(p, near) - near.radius > range) return null;
      a.enemy = near;
      a.hits = 1;
      a.dir = Math.atan2(near.y - p.y, near.x - p.x);
      return a;
    }
    if (tg.mode === 'ground') {
      let best = -1;
      for (const e of this.enemies) {
        if (!e.alive || dist(p, e) - e.radius > range) continue;
        const n = this.hitsFor(s, e, 0).length;
        if (n > best) {
          best = n;
          a.x = e.x;
          a.y = e.y;
        }
      }
      if (best < 1) return null;
      a.hits = best;
      return a;
    }
    // direction: cones / lines aimed at an enemy
    const reach = Math.max(s.shape.radius ?? 0, s.shape.length ?? 0, range);
    let best = -1;
    for (const e of this.enemies) {
      if (!e.alive || dist(p, e) - e.radius > reach) continue;
      const dir = Math.atan2(e.y - p.y, e.x - p.x);
      const n = this.hitsFor(s, p, dir).length;
      if (n > best) {
        best = n;
        a.dir = dir;
      }
    }
    if (best < 1) return null;
    a.hits = best;
    return a;
  }
  private pickAlly(p: Player, s: SkillDef): Player | null {
    const range = s.targeting.range_tiles ?? 8;
    const cands = this.players.filter((q) => q.alive && (q === p || dist(p, q) <= range));
    const wantsHeal = s.effects.some((e) => e.type === 'heal');
    const wantsShield = s.effects.some((e) => e.type === 'shield');
    const wantsRevive = s.effects.some((e) => e.type === 'revive') && this.grouped(p);
    if (wantsRevive) {
      const dead = this.players.find((q) => !q.alive && dist(p, q) <= range);
      if (dead) return dead;
    }
    if (wantsHeal) return cands.sort((a, b) => a.hp / a.hpMax - b.hp / b.hpMax)[0] ?? null;
    if (wantsShield) {
      const tank = this.currentTank();
      const pool = tank && cands.includes(tank) ? [tank, ...cands.filter((q) => q !== tank)] : cands;
      return pool.find((q) => q.shields.reduce((n, x) => n + x.amt, 0) < q.hpMax * 0.15) ?? pool[0] ?? null;
    }
    return p;
  }
  private currentTank(): Player | null {
    const b = this.enemies.find((e) => e.boss && e.alive);
    if (b) return this.players[b.target] ?? null;
    const counts = new Map<number, number>();
    for (const e of this.enemies) if (e.alive && e.target >= 0) counts.set(e.target, (counts.get(e.target) ?? 0) + 1);
    let best: number | null = null;
    for (const [k, v] of counts) if (best === null || v > (counts.get(best) ?? 0)) best = k;
    return best === null ? null : (this.players[best] ?? null);
  }

  // ---------------------------------------------------------------- skills
  private patch(p: Player, s: SkillDef) {
    return p.branch.skill_patches[s.id] ?? {};
  }
  private cooldownOf(p: Player, s: SkillDef): number {
    return s.timing.cooldown_ms * (this.patch(p, s).cooldown_mult ?? 1);
  }
  private ready(p: Player, s: SkillDef): boolean {
    return (p.cd.get(s.id) ?? 0) <= this.t && p.mp >= (s.cost?.mp_pct ?? 0) * p.mpMax - 1e-9;
  }
  private timeCost(s: SkillDef): number {
    const t = s.timing;
    return Math.max((t.cast_ms + (t.channel_ms ?? 0)) / 1000, t.gcd === false ? 0.2 : this.gcd / 1000);
  }
  private activeEffects(s: SkillDef, grouped: boolean): SkillEffect[] {
    return s.effects.filter((e) => effectActive(e, grouped));
  }
  /** Greedy value of casting `s` now; <= 0 means "do not cast". Utility values are in pseudo basic-hit/s. */
  private score(p: Player, s: SkillDef, aim: Aim, ctxs: { grouped: boolean; adj: number; engaged: boolean }): number {
    const fx = this.activeEffects(s, ctxs.grouped);
    const hpPct = p.hp / p.hpMax;
    const tgt = aim.ally ?? p;
    const time = this.timeCost(s);
    let dmgE = 0;
    let util = 0;
    for (const e of fx) {
      switch (e.type) {
        case 'damage':
          dmgE += equivalentHits(e.scale!.coeff, e.hits ?? 1) * Math.max(1, aim.hits);
          break;
        case 'dot':
          dmgE +=
            equivalentHits(e.scale!.coeff, 1) *
            ((e.duration_ms ?? 0) / (e.tick_interval_ms ?? 1000)) *
            Math.max(1, aim.hits) *
            0.5;
          break;
        case 'detonate': {
          let st = 0;
          for (const en of this.enemies)
            if (en.alive && dist(p, en) <= (e.radius ?? 5)) st += en.marks.get(e.mark_id ?? '')?.stacks ?? 0;
          dmgE += equivalentHits(e.scale!.coeff, 1) * st;
          if (st === 0 && fx.every((x) => x.type === 'detonate')) return -1;
          break;
        }
        case 'mark':
          dmgE += 0.3;
          break;
        case 'heal': {
          const amt = this.healAmount(p, e, tgt);
          const miss = tgt.hpMax - tgt.hp;
          if (tgt.hp / tgt.hpMax < 0.55 || miss > amt * 0.8) util += tgt.hp / tgt.hpMax < 0.45 ? 80 : 40;
          break;
        }
        case 'hot': {
          const centre: V = s.targeting.mode === 'ground' ? { x: aim.x, y: aim.y } : p;
          const members = this.players.filter((q) => q.alive && dist(q, centre) <= (e.radius ?? 4));
          const missing = members.reduce((n, q) => n + (q.hpMax - q.hp) / q.hpMax, 0);
          if (missing >= 0.45) util += 30;
          if (ctxs.engaged && missing >= 0.3) util += 3;
          break;
        }
        case 'shield': {
          const held = tgt.shields.reduce((n, x) => n + x.amt, 0);
          if (ctxs.engaged && held < tgt.hpMax * 0.1) util += hpPct < 0.7 || tgt !== p ? 30 : 4;
          break;
        }
        case 'buff': {
          const stat = e.stat ?? '';
          if (!ctxs.engaged) break;
          const active = p.buffs.some((b) => b.stat === stat && b.until > this.t + 1500 && b.src === p.id);
          if (active) break;
          if (stat === 'dr_pct') util += hpPct < 0.6 || (this.currentTank() === p && this.grouped(p)) ? 30 : 0;
          else if (stat === 'lifesteal') util += hpPct < 0.85 ? 3 : 0;
          else util += 3;
          break;
        }
        case 'debuff':
          if (ctxs.engaged && aim.hits > 0) util += 1;
          break;
        case 'status': {
          const hard = e.status_id !== undefined && (HARD_CC as readonly string[]).includes(e.status_id);
          if (ctxs.adj >= 2 || (hpPct < 0.7 && ctxs.adj >= 1)) util += hard ? 3 : e.status_id === 'slow' ? 0.5 : 0;
          else if (aim.hits >= 1 && !hard && e.status_id === 'slow') util += 0;
          break;
        }
        case 'taunt': {
          const tank = this.currentTank();
          if (this.grouped(p) && ctxs.engaged && tank !== p) util += 60;
          break;
        }
        case 'pull':
          if (ctxs.adj < 3 && this.enemies.filter((x) => x.alive && dist(p, x) <= (e.radius ?? 4)).length >= 3)
            util += 3;
          break;
        case 'revive': {
          if (aim.ally && !aim.ally.alive) util += 300;
          break;
        }
        case 'dash': {
          if (hpPct < 0.75 && ctxs.adj >= 2) util += 150;
          break;
        }
        case 'restore_mp':
          if (p.mp / p.mpMax < 0.7) util += 4;
          break;
        default:
          break;
      }
    }
    const isDashOnly = s.tags.includes('mobility') && dmgE === 0 && !fx.some((e) => e.type === 'status');
    if (isDashOnly && util < 100) return -1;
    return dmgE / time + util;
  }
  healAmount(p: Player, e: SkillEffect, to: Player): number {
    const st = e.scale!.stat;
    const base = st === 'atk' ? p.atk : st === 'hp_max' ? p.hpMax : st === 'target_hp_max' ? to.hpMax : p.atk;
    return e.scale!.coeff * base * (p.branch.stat_mods.heal_mult ?? 1);
  }

  private startCast(p: Player, s: SkillDef, aim: Aim): void {
    const t = s.timing;
    const cost = (s.cost?.mp_pct ?? 0) * p.mpMax;
    p.mp -= cost;
    p.c.mpSpent += cost;
    p.c.casts++;
    p.c.bySkill[s.id] = (p.c.bySkill[s.id] ?? 0) + 1;
    const cast = t.cast_ms;
    const total = cast + (t.channel_ms ?? 0);
    const g = this.grouped(p);
    const ticks: number[] = [];
    if (t.channel_ms && t.channel_ticks)
      for (let i = 1; i <= t.channel_ticks; i++) ticks.push(this.t + cast + (t.channel_ms * i) / t.channel_ticks);
    p.cast = { skill: s, resolveAt: this.t + cast, ticks, tickIdx: 0, aim, resolved: false, mpSpent: cost, grouped: g };
    p.busyUntil = this.t + Math.max(total, t.gcd === false ? 0 : this.gcd);
    if (t.invuln_ms) p.invulnUntil = Math.max(p.invulnUntil, this.t + t.invuln_ms);
    p.cd.set(s.id, this.t + total + this.cooldownOf(p, s));
  }

  private resolveCast(p: Player, c: Cast): void {
    const s = c.skill;
    const aim = c.aim;
    const channel = !!s.timing.channel_ms;
    // revalidate aim for mobile enemies: recompute the shape origin/direction at the effect frame
    const origin: V = s.shape.anchor === 'ground_point' ? { x: aim.x, y: aim.y } : p;
    const fx = this.activeEffects(s, c.grouped);
    const pt = this.patch(p, s);
    // dash first (moves the caster before hits resolve)
    for (const e of fx) if (e.type === 'dash') this.doDash(p, s, e, aim);
    const targets =
      s.targeting.mode === 'enemy' && aim.enemy
        ? aim.enemy.alive
          ? [aim.enemy]
          : []
        : this.hitsFor(s, s.shape.anchor === 'caster' ? p : origin, aim.dir);
    const dmgMult = pt.damage_mult ?? 1;
    for (const e of fx) {
      switch (e.type) {
        case 'damage':
          if (!channel) {
            let any = false;
            for (const en of targets)
              for (let h = 0; h < (e.hits ?? 1); h++) {
                this.hit(p, en, e.scale!.coeff * dmgMult, e.pen ?? 0);
                any = true;
              }
            if (any) this.onHitDealt(p);
          }
          break;
        case 'dot':
          for (const en of targets)
            en.dots.push({
              src: p.id,
              perTick: this.dotTick(p, en, e.scale!.coeff * dmgMult),
              interval: e.tick_interval_ms ?? 1000,
              nextAt: this.t + (e.tick_interval_ms ?? 1000),
              until: this.t + (e.duration_ms ?? 0),
            });
          break;
        case 'status':
          for (const en of targets)
            this.applyStatus(p, en, e.status_id!, (e.duration_ms ?? 0) * (pt.duration_mult ?? 1), e.magnitude ?? 0);
          break;
        case 'knockback':
          for (const en of targets) {
            if (en.boss) this.interruptBoss(p, en);
            else this.push(p, en, e.distance_tiles ?? 0);
          }
          break;
        case 'pull': {
          const r = e.radius ?? 4;
          for (const en of this.enemies)
            if (en.alive && !en.boss && dist(p, en) <= r) this.pullTo(p, en, e.distance_tiles ?? 0);
          break;
        }
        case 'taunt': {
          const r = e.radius ?? 4;
          const ms = (e.duration_ms ?? 0) * (pt.duration_mult ?? 1);
          for (const en of this.enemies) {
            if (!en.alive || dist(p, en) > r + en.radius) continue;
            en.forced = { pid: p.id, until: this.t + ms };
            const top = Math.max(0, ...en.threat.values());
            en.threat.set(p.id, Math.max(en.threat.get(p.id) ?? 0, top * 1.1 + 1));
          }
          break;
        }
        case 'debuff':
          for (const en of targets)
            en.shreds.push({ mag: (e.magnitude ?? 0) * (pt.debuff_mult ?? 1), until: this.t + (e.duration_ms ?? 0) });
          break;
        case 'mark':
          for (const en of targets) this.applyMark(p, en, e, dmgMult);
          break;
        case 'detonate': {
          for (const en of this.enemies) {
            if (!en.alive || dist(p, en) > (e.radius ?? 5) + en.radius) continue;
            const m = en.marks.get(e.mark_id ?? '');
            if (m && m.until > this.t) {
              for (let i = 0; i < m.stacks; i++) this.hit(p, en, e.scale!.coeff * dmgMult);
              en.marks.delete(e.mark_id ?? '');
            }
          }
          break;
        }
        case 'heal': {
          const to = aim.ally ?? p;
          if (!to.alive) break;
          this.healTo(p, to, this.healAmount(p, e, to), false, e.overheal_to_shield ?? 0, e.shield_duration_ms ?? 6000);
          break;
        }
        case 'shield': {
          const to = e.applies_to === 'ally' ? (aim.ally ?? p) : p;
          const st = e.scale!.stat;
          const base = st === 'atk' ? p.atk : st === 'target_hp_max' ? to.hpMax : p.hpMax;
          const amt = e.scale!.coeff * base * (p.branch.stat_mods.shield_mult ?? 1) * (pt.shield_mult ?? 1);
          this.addShield(p, to, amt, (e.duration_ms ?? 0) * (pt.duration_mult ?? 1), e.explode);
          break;
        }
        case 'hot': {
          const r = e.radius ?? 4;
          const cx = s.targeting.mode === 'ground' ? aim.x : p.x;
          const cy = s.targeting.mode === 'ground' ? aim.y : p.y;
          const per =
            e.scale!.coeff * (e.scale!.stat === 'hp_max' ? p.hpMax : p.atk) * (p.branch.stat_mods.heal_mult ?? 1);
          if (e.applies_to === 'self')
            this.zones.push({
              x: p.x,
              y: p.y,
              src: p.id,
              perTick: per,
              interval: e.tick_interval_ms ?? 1000,
              nextAt: this.t + (e.tick_interval_ms ?? 1000),
              until: this.t + (e.duration_ms ?? 0),
              radius: 99,
            });
          else
            this.zones.push({
              x: cx,
              y: cy,
              src: p.id,
              perTick: per,
              interval: e.tick_interval_ms ?? 1000,
              nextAt: this.t + (e.tick_interval_ms ?? 1000),
              until: this.t + (e.duration_ms ?? 0),
              radius: r,
            });
          break;
        }
        case 'buff': {
          const mag = (e.magnitude ?? 0) * (pt.buff_mult ?? 1);
          const ms = (e.duration_ms ?? 0) * (pt.duration_mult ?? 1);
          const rcv =
            e.applies_to === 'all'
              ? this.players.filter(
                  (q) =>
                    q.alive && dist(q, s.targeting.mode === 'ground' ? { x: aim.x, y: aim.y } : p) <= (e.radius ?? 12),
                )
              : [p];
          for (const q of rcv) {
            q.buffs = q.buffs.filter((b) => !(b.stat === e.stat && b.src === p.id));
            q.buffs.push({ stat: e.stat ?? '', mag, until: this.t + ms, src: p.id });
          }
          break;
        }
        case 'revive': {
          const to = aim.ally;
          if (to && !to.alive) {
            to.alive = true;
            to.hp = to.hpMax * (e.magnitude ?? 0.4);
            to.invulnUntil = this.t + 1000;
          }
          break;
        }
        case 'restore_mp':
          p.mp = Math.min(p.mpMax, p.mp + p.mpMax * (e.magnitude ?? 0));
          break;
        default:
          break;
      }
    }
    c.resolved = true;
    void channel;
  }
  private tickChannel(p: Player, c: Cast): void {
    const s = c.skill;
    const pt = this.patch(p, s);
    const origin: V = s.shape.anchor === 'ground_point' ? { x: c.aim.x, y: c.aim.y } : p;
    const targets = this.hitsFor(s, origin, c.aim.dir);
    let any = false;
    for (const e of this.activeEffects(s, c.grouped)) {
      if (e.type !== 'damage') continue;
      for (const en of targets) {
        this.hit(p, en, e.scale!.coeff * (pt.damage_mult ?? 1), e.pen ?? 0);
        any = true;
      }
    }
    if (any) this.onHitDealt(p);
  }
  private dotTick(p: Player, e: Enemy, coeff: number): number {
    const m = this.dmgMods(p);
    return computeDamage({ atk: p.atk, def: this.enemyDef(e), cSkill: coeff }) * m.mult;
  }
  private onHitDealt(p: Player): void {
    const tr = p.cls.trait;
    if (tr && (tr.gain_on === 'hit_dealt' || tr.gain_on === 'both')) this.gainStack(p);
  }
  private applyMark(p: Player, e: Enemy, fx: SkillEffect, dmgMult: number): void {
    const id = fx.mark_id ?? '';
    const cur = e.marks.get(id);
    let stacks = cur && cur.until > this.t ? cur.stacks : 0;
    stacks++;
    if (stacks >= (fx.max_stacks ?? 3)) {
      for (let i = 0; i < stacks; i++) this.hit(p, e, (fx.detonate_coeff ?? 1) * dmgMult);
      e.marks.delete(id);
      const r = fx.detonate_radius ?? 0;
      if (r > 0) {
        for (const o of this.enemies) {
          if (o !== e && o.alive && dist(e, o) <= r + o.radius)
            this.hit(p, o, (fx.detonate_coeff ?? 1) * dmgMult * SIM.MARK_SPLASH);
        }
      }
    } else e.marks.set(id, { stacks, until: this.t + (fx.duration_ms ?? 0) });
  }
  private doDash(p: Player, s: SkillDef, e: SkillEffect, aim: Aim): void {
    const d = e.distance_tiles ?? 0;
    if (this.scenario === 'boss') return; // fixed positions in the boss fight
    if (e.direction === 'back') {
      const cx = this.enemies.filter((x) => x.alive);
      let ax = 0;
      let ay = 0;
      for (const en of cx) {
        ax += en.x;
        ay += en.y;
      }
      const dir = cx.length ? Math.atan2(ay / cx.length - p.y, ax / cx.length - p.x) + Math.PI : Math.PI;
      p.x += Math.cos(dir) * d;
      p.y += Math.sin(dir) * d;
      return;
    }
    const hits = this.hitsFor(s, p, aim.dir);
    let go = d;
    if (hits.length) go = Math.min(d, Math.max(...hits.map((h) => dist(p, h))));
    else {
      const near = this.nearestEnemy(p);
      if (near) go = Math.max(0, Math.min(d, dist(p, near) - 1.0));
    }
    p.x += Math.cos(aim.dir) * go;
    p.y += Math.sin(aim.dir) * go;
  }
  private push(from: V, e: Enemy, d: number): void {
    const a = Math.atan2(e.y - from.y, e.x - from.x);
    e.x += Math.cos(a) * d;
    e.y += Math.sin(a) * d;
  }
  private pullTo(p: V, e: Enemy, d: number): void {
    const cur = dist(p, e);
    const to = Math.max(SIM.MOB.ring_radius, cur - d);
    const a = Math.atan2(e.y - p.y, e.x - p.x);
    e.x = p.x + Math.cos(a) * to;
    e.y = p.y + Math.sin(a) * to;
  }

  // ---------------------------------------------------------------- player AI
  private playerTick(p: Player): void {
    if (!p.alive) return;
    // expire
    p.buffs = p.buffs.filter((b) => b.until > this.t);
    for (let i = 0; i < p.shields.length;) {
      const s = p.shields[i]!;
      if (s.until <= this.t) {
        p.shields.splice(i, 1);
        this.explodeShield(p, s);
      } else i++;
    }
    // channel ticks / cast resolution
    const c = p.cast;
    if (c) {
      if (this.t >= c.resolveAt && !c.resolved) this.resolveCast(p, c);
      while (c.tickIdx < c.ticks.length && this.t >= c.ticks[c.tickIdx]!) {
        this.tickChannel(p, c);
        c.tickIdx++;
      }
      if (
        c.resolved &&
        c.tickIdx >= c.ticks.length &&
        this.t >= Math.max(c.resolveAt, c.ticks[c.ticks.length - 1] ?? 0)
      )
        p.cast = null;
    }
    // mp regen
    const engaged = this.enemies.some((e) => e.alive);
    if (engaged) p.mp = Math.min(p.mpMax, p.mp + (p.mpMax * SIM.MP_REGEN_COMBAT_PCT_PER_S * SIM.TICK_MS) / 1000);
    // pet
    if (p.petCoeff > 0 && this.t >= p.petNextAt) {
      p.petNextAt = this.t + p.petInterval;
      const e = this.nearestEnemy(p);
      if (e && dist(p, e) < 9) p.c.petDamage += this.hit(p, e, p.petCoeff);
    }
    if (this.t < p.stunUntil) {
      if (p.cast && p.cast.skill.timing.interruptible !== false) this.interruptCast(p);
      return;
    }
    if (p.cast) {
      if (this.t < p.busyUntil) return;
    }
    if (this.t < p.busyUntil) return;
    this.act(p);
  }
  private interruptCast(p: Player): void {
    if (!p.cast) return;
    if (!p.cast.resolved) {
      p.mp += p.cast.mpSpent * 0.5;
      p.cd.set(p.cast.skill.id, this.t);
    }
    p.cast = null;
    p.busyUntil = this.t;
  }
  private act(p: Player): void {
    const g = this.grouped(p);
    const boss = this.enemies.find((e) => e.boss && e.alive) ?? null;
    const engagedEnemies = this.enemies.filter((e) => e.alive);
    const near = this.nearestEnemy(p);
    const engaged = near !== null && dist(p, near) - near.radius <= 9;
    const adj = this.enemies.filter((e) => e.alive && dist(p, e) - e.radius <= 1.6).length;
    const hpPct = p.hp / p.hpMax;
    // pill (universal sustain)
    if (hpPct < SIM.PILL.use_below_hp_pct && p.pills > 0 && this.t >= p.pillReadyAt && engagedEnemies.length) {
      p.pills--;
      p.pillReadyAt = this.t + SIM.PILL.cooldown_ms;
      p.c.pills++;
      this.healTo(p, p, p.hpMax * SIM.PILL.heal_pct * (1 + (p.passive.potion_power ?? 0)));
    }
    // boss interrupt / dodge
    let forced: { s: SkillDef; aim: Aim } | null = null;
    if (
      boss &&
      this.bossNukeAt >= 0 &&
      (this.nukeClaim < 0 || this.nukeClaim === p.id || !this.players[this.nukeClaim]!.alive)
    ) {
      for (const s of p.skills) {
        if (s.kind !== 'active' || !this.ready(p, s)) continue;
        const fx = this.activeEffects(s, g);
        if (
          !fx.some(
            (e) =>
              e.type === 'knockback' ||
              (e.type === 'status' && e.status_id && (HARD_CC as readonly string[]).includes(e.status_id)),
          )
        )
          continue;
        const aim = this.aimFor(p, s);
        if (aim && (aim.hits > 0 || aim.enemy)) {
          forced = { s, aim };
          this.nukeClaim = p.id;
          break;
        }
      }
    }
    if (
      !forced &&
      boss &&
      this.bossCleaveAt >= 0 &&
      dist(p, boss) < SIM.BOSS.cleave_radius + boss.radius &&
      !this.bossDodged.has(p.id)
    ) {
      const d = p.skills.find(
        (s) =>
          s.kind === 'active' &&
          s.tier !== 'ultimate' &&
          s.tags.includes('mobility') &&
          this.ready(p, s) &&
          s.effects.some((e) => e.type === 'dash'),
      );
      if (d) {
        this.bossDodged.add(p.id);
        p.cd.set(d.id, this.t + d.timing.cooldown_ms * (this.patch(p, d).cooldown_mult ?? 1));
        p.mp -= (d.cost?.mp_pct ?? 0) * p.mpMax;
        p.invulnUntil = Math.max(p.invulnUntil, this.bossCleaveAt + 100);
        p.busyUntil = this.t + (d.timing.cast_ms || 200);
        return;
      }
    }
    if (forced) {
      this.startCast(p, forced.s, forced.aim);
      return;
    }
    // greedy choice
    let best: { s: SkillDef; aim: Aim; v: number } | null = null;
    for (const s of p.skills) {
      if (s.kind !== 'active' || !this.ready(p, s)) continue;
      // Hold boss-interrupt skills when casting now would leave them on cooldown at the next Đại Chiêu.
      if (boss && this.isInterrupt(s, g) && this.bossNextNuke - this.t <= this.cooldownOf(p, s) + 1000) continue;
      const aim = this.aimFor(p, s);
      if (!aim) continue;
      const v = this.score(p, s, aim, { grouped: g, adj, engaged });
      if (v > 0 && (!best || v > best.v)) best = { s, aim, v };
    }
    const bc = p.cls.basic_attack;
    const basicV = 1.15;
    if (best && best.v > basicV) {
      this.startCast(p, best.s, best.aim);
      return;
    }
    // basic attack
    if (near && dist(p, near) - near.radius <= bc.range_tiles) {
      if (this.t >= p.nextBasicAt) {
        const coeff = bc.coeffs[p.basicIdx % bc.coeffs.length]!;
        p.basicIdx++;
        p.nextBasicAt = this.t + bc.interval_ms;
        p.busyUntil = this.t + bc.interval_ms;
        this.hit(p, near, coeff);
        this.onHitDealt(p);
        p.mp = Math.min(p.mpMax, p.mp + p.mpMax * SIM.MP_PER_BASIC_HIT_PCT);
      }
      return;
    }
    // move toward the nearest enemy (not in boss fight: positions are fixed there)
    if (near && this.scenario !== 'boss' && this.t >= p.rootUntil) {
      const d = dist(p, near) - near.radius;
      const stop = Math.max(0.3, bc.range_tiles * 0.85);
      const step = Math.min(d - stop, (this.speedOf(p) * SIM.TICK_MS) / 1000);
      if (step > 0) {
        const a = Math.atan2(near.y - p.y, near.x - p.x);
        p.x += Math.cos(a) * step;
        p.y += Math.sin(a) * step;
      }
    }
  }
  private speedOf(p: Player): number {
    let v = SIM.MOVE_SPEED_TILES_PER_S * (1 + this.statSum(p, 'move_speed_pct'));
    if (this.t < p.slowUntil) v *= 1 - p.slowMag;
    return v;
  }

  // ---------------------------------------------------------------- enemy AI
  private chooseTarget(e: Enemy): Player | null {
    const alive = this.players.filter((q) => q.alive);
    if (!alive.length) return null;
    if (e.forced && e.forced.until > this.t) {
      const f = this.players[e.forced.pid]!;
      if (f.alive) return f;
    }
    if (alive.length === 1) return alive[0]!;
    let best: Player | null = null;
    let bt = -1;
    for (const q of alive) {
      const th = e.threat.get(q.id) ?? 0;
      if (th > bt) {
        bt = th;
        best = q;
      }
    }
    const cur = this.players[e.target];
    if (cur && cur.alive && best && (e.threat.get(cur.id) ?? 0) * 1.1 >= bt) return cur;
    if (!best || bt <= 0) return this.players.filter((q) => q.alive).sort((a, b) => dist(a, e) - dist(b, e))[0] ?? null;
    return best;
  }
  private enemyTick(e: Enemy): void {
    if (!e.alive) return;
    e.dots = e.dots.filter((d) => d.until > this.t);
    for (const d of e.dots) {
      if (this.t >= d.nextAt) {
        d.nextAt += d.interval;
        const src = this.players[d.src]!;
        const dmg = Math.min(d.perTick, e.hp);
        e.hp -= dmg;
        src.c.damage += dmg;
        if (e.hp <= 0) e.alive = false;
      }
    }
    if (!e.alive) return;
    if (e.boss) return this.bossTick(e);
    const tgt = this.chooseTarget(e);
    if (!tgt) return;
    e.target = tgt.id;
    if (this.t < e.stunUntil) return;
    const slotX = tgt.x + Math.cos(e.angle) * SIM.MOB.ring_radius;
    const slotY = tgt.y + Math.sin(e.angle) * SIM.MOB.ring_radius;
    const dSlot = Math.hypot(slotX - e.x, slotY - e.y);
    const dT = dist(tgt, e);
    if (dT > SIM.MOB.melee_reach && this.t >= e.rootUntil) {
      let sp = SIM.MOB.speed;
      if (this.t < e.slowUntil) sp *= 1 - e.slowMag;
      const step = Math.min(dSlot, (sp * SIM.TICK_MS) / 1000);
      e.x += ((slotX - e.x) / (dSlot || 1)) * step;
      e.y += ((slotY - e.y) / (dSlot || 1)) * step;
    }
    if (dist(tgt, e) <= SIM.MOB.melee_reach && this.t >= e.nextAtkAt) {
      e.nextAtkAt = this.t + SIM.MOB.atk_interval_ms;
      const raw = computeDamage({ atk: e.atk, def: this.defOf(tgt), cSkill: 1 });
      this.hurt(tgt, raw, e, !!(e.forced && e.forced.until > this.t));
    }
  }
  private bossTick(e: Enemy): void {
    const B = SIM.BOSS;
    if (!this.enraged && this.t >= B.enrage_ms) this.enraged = true;
    const staggered = this.t < e.staggerUntil;
    if (staggered) return;
    const tgt = this.chooseTarget(e);
    if (tgt) e.target = tgt.id;
    // nuke
    if (this.bossNukeAt < 0 && this.t >= this.bossNextNuke) {
      this.bossNukeAt = this.t + B.nuke_cast_ms;
      this.nukeClaim = -1;
    }
    if (this.bossNukeAt >= 0 && this.t >= this.bossNukeAt) {
      this.bossNukeAt = -1;
      this.bossNextNuke = this.t + B.nuke_every_ms;
      for (const q of this.players)
        if (q.alive) this.hurt(q, computeDamage({ atk: e.atk, def: this.defOf(q), cSkill: B.nuke_coeff }), e);
    }
    // cleave
    if (this.bossCleaveAt < 0 && this.t >= this.bossNextCleave) {
      this.bossCleaveAt = this.t + B.cleave_telegraph_ms;
      this.bossDodged.clear();
    }
    if (this.bossCleaveAt >= 0 && this.t >= this.bossCleaveAt) {
      this.bossCleaveAt = -1;
      this.bossNextCleave = this.t + B.cleave_every_ms;
      for (const q of this.players) {
        if (q.alive && dist(q, e) <= B.cleave_radius + e.radius)
          this.hurt(q, computeDamage({ atk: e.atk, def: this.defOf(q), cSkill: B.cleave_coeff }), e);
      }
    }
    // auto attack on the current target
    if (tgt && this.t >= this.bossNextAuto && this.bossNukeAt < 0) {
      this.bossNextAuto = this.t + B.auto_interval_ms;
      this.hurt(
        tgt,
        computeDamage({ atk: e.atk, def: this.defOf(tgt), cSkill: B.auto_coeff }),
        e,
        !!(e.forced && e.forced.until > this.t),
      );
    }
  }
  private zoneTick(): void {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i]!;
      if (z.until <= this.t) {
        this.zones.splice(i, 1);
        continue;
      }
      if (this.t < z.nextAt) continue;
      z.nextAt += z.interval;
      const src = this.players[z.src]!;
      for (const q of this.players) {
        if (!q.alive) continue;
        if (z.radius < 90 && dist(q, z) > z.radius) continue;
        if (z.radius >= 90 && q !== src) continue;
        this.healTo(src, q, z.perTick);
      }
    }
  }

  step(): void {
    this.t += SIM.TICK_MS;
    for (const p of this.players) this.playerTick(p);
    this.zoneTick();
    for (const e of this.enemies) this.enemyTick(e);
  }
  allEnemiesDead(): boolean {
    return this.enemies.every((e) => !e.alive);
  }
  allPlayersDead(): boolean {
    return this.players.every((p) => !p.alive);
  }
}

// ------------------------------------------------------------------ runners
export interface SoloPackResult {
  cleared: boolean;
  died: boolean;
  timeS: number;
  hpLostPct: number;
  counters: PlayerCounters;
  endHpPct: number;
}
export function runSoloPack(spec: SimPlayerSpec, seed: number, opts: Partial<WorldOpts> = {}): SoloPackResult {
  const w = new World({ scenario: 'pack', players: [spec], seed, ...opts });
  const p = w.players[0]!;
  const limit = SIM.SOLO_PACK_LIMIT_MS;
  while (w.t < limit && !w.allEnemiesDead() && p.alive) w.step();
  return {
    cleared: w.allEnemiesDead() && p.alive,
    died: !p.alive,
    timeS: w.t / 1000,
    hpLostPct: p.c.taken / p.hpMax,
    counters: p.c,
    endHpPct: p.hp / p.hpMax,
  };
}

export interface DummyResult {
  dps: number;
  basicDps: number;
  ratio: number;
  petDps: number;
  mpPerS: number;
  counters: PlayerCounters;
}
/** Rotation DPS vs a never-dying dummy (docs/11 §4.5), as a multiple of the class' pure basic-attack DPS. */
export function runDummy(spec: SimPlayerSpec, opts: Partial<WorldOpts> = {}): DummyResult {
  const run = (basicOnly: boolean): World => {
    const w = new World({
      scenario: 'dummy',
      players: [spec],
      seed: 1,
      noPills: true,
      ...opts,
      ...(basicOnly ? { noBranch: true } : {}),
    });
    const p = w.players[0]!;
    if (basicOnly) for (const s of p.skills) p.cd.set(s.id, Infinity);
    p.pills = 0;
    while (w.t < SIM.DUMMY.duration_ms) w.step();
    return w;
  };
  const full = run(false);
  const basic = run(true);
  const secs = SIM.DUMMY.duration_ms / 1000;
  const p = full.players[0]!;
  const fullNoPet = p.c.damage - p.c.petDamage;
  return {
    dps: fullNoPet / secs,
    basicDps: basic.players[0]!.c.damage / secs,
    ratio: fullNoPet / basic.players[0]!.c.damage,
    petDps: p.c.petDamage / secs,
    mpPerS: p.c.mpSpent / p.mpMax / secs,
    counters: p.c,
  };
}

export interface BossResult {
  win: boolean;
  timeS: number;
  deaths: number;
  survivors: number;
  players: { path: PathId; mode: 'solo' | 'team'; counters: PlayerCounters; etd: number }[];
  teamEtd: number;
}
/** Effective team DPS of one player: own damage + damage others gained from its buffs + W · HP kept alive for others. */
export function effectiveTeamDps(c: PlayerCounters, seconds: number): number {
  const value = c.healOthers + c.shieldOthers + c.drOthers + c.soak;
  return (c.damage + c.buffExtra + SIM.ETD_W * value) / Math.max(1, seconds);
}
export function runBoss(team: SimPlayerSpec[], seed: number, opts: Partial<WorldOpts> = {}): BossResult {
  const w = new World({ scenario: 'boss', players: team, seed, ...opts });
  while (w.t < SIM.BOSS_LIMIT_MS && !w.allEnemiesDead() && !w.allPlayersDead()) w.step();
  const win = w.allEnemiesDead();
  const secs = w.t / 1000;
  const players = w.players.map((p, i) => ({
    path: team[i]!.path,
    mode: team[i]!.mode,
    counters: p.c,
    etd: effectiveTeamDps(p.c, secs),
  }));
  return {
    win,
    timeS: secs,
    deaths: w.players.reduce((n, p) => n + p.c.deaths, 0),
    survivors: w.players.filter((p) => p.alive).length,
    players,
    teamEtd: players.reduce((n, p) => n + p.etd, 0),
  };
}

// ------------------------------------------------------------------ batch helpers
export const SIM_SEEDS: readonly number[] = Array.from({ length: 24 }, (_v, i) => 1000 + i * 7919);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export interface SoloPackSummary {
  path: PathId;
  mode: 'solo' | 'team';
  runs: number;
  clearTimeS: number;
  deathRate: number;
  meanHpLostPct: number;
  meanEndHpPct: number;
}
export function summariseSoloPack(
  path: PathId,
  mode: 'solo' | 'team',
  opts: Partial<WorldOpts> = {},
  seeds = SIM_SEEDS,
): SoloPackSummary {
  const rs = seeds.map((s, i) =>
    runSoloPack({ path, mode }, s, { mobAtkMult: SIM.PACK_STRENGTHS[i % SIM.PACK_STRENGTHS.length], ...opts }),
  );
  const ok = rs.filter((r) => r.cleared);
  return {
    path,
    mode,
    runs: rs.length,
    clearTimeS: mean(ok.map((r) => r.timeS)),
    deathRate: rs.filter((r) => r.died || !r.cleared).length / rs.length,
    meanHpLostPct: mean(rs.map((r) => r.hpLostPct)),
    meanEndHpPct: mean(rs.map((r) => r.endHpPct)),
  };
}

export interface BossSummary {
  runs: number;
  winRate: number;
  killTimeS: number;
  deathsPerRun: number;
  teamEtd: number;
  perPlayerEtd: number[];
}
export function summariseBoss(team: SimPlayerSpec[], opts: Partial<WorldOpts> = {}, seeds = SIM_SEEDS): BossSummary {
  const rs = seeds.map((s) => runBoss(team, s, opts));
  const wins = rs.filter((r) => r.win);
  return {
    runs: rs.length,
    winRate: wins.length / rs.length,
    killTimeS: mean(wins.map((r) => r.timeS)),
    deathsPerRun: mean(rs.map((r) => r.deaths)),
    teamEtd: mean(rs.map((r) => r.teamEtd)),
    perPlayerEtd: team.map((_t, i) => mean(rs.map((r) => r.players[i]!.etd))),
  };
}
