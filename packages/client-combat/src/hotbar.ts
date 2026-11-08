/**
 * Class hotbar (D49, docs/11): the 8 skills of a Đạo Lộ in unlock order, with per-slot cooldown and the shared global cooldown.
 * Pure state + arithmetic on a caller-supplied monotonic clock (`nowMs`): no timers, no Date.now, so it is trivially testable and
 * the same code can later be driven by server-confirmed casts. Nothing here decides whether a cast is legal beyond cooldown/GCD:
 * target, range and MP are checked by the combat loop (`MockCombat` today, the server later).
 */
import { skillDefinitions, skillsOf } from '@vgtd/shared';
import type { PathId, SkillDef, SkillDefinitions } from '@vgtd/shared';

/** A class kit has exactly 8 skills (D49). */
export const HOTBAR_SLOTS = 8;

export type CastBlock = 'empty' | 'passive' | 'cooldown' | 'gcd' | 'busy' | 'mp' | 'no_target' | 'range' | 'dead';

export interface HotbarSlot {
  /** 0-based slot index (key 1..8). */
  readonly index: number;
  readonly skill: SkillDef;
  /** Passives (kind 'passive') sit on the bar for display but cannot be cast. */
  readonly castable: boolean;
}

export class Hotbar {
  readonly slots: readonly HotbarSlot[];
  /** Global cooldown (ms) from the skill definitions (`global.gcd_ms`, default 800). */
  readonly gcdMs: number;
  private readonly cdEnd: number[];
  private readonly cdStart: number[];
  private gcdStart = 0;
  private gcdEnd = 0;

  constructor(
    readonly path: PathId,
    defs: SkillDefinitions = skillDefinitions,
  ) {
    this.slots = skillsOf(path, defs)
      .slice(0, HOTBAR_SLOTS)
      .map((skill, index) => ({ index, skill, castable: skill.kind === 'active' }));
    this.gcdMs = defs.global.gcd_ms ?? 800;
    this.cdEnd = this.slots.map(() => 0);
    this.cdStart = this.slots.map(() => 0);
  }

  slot(index: number): HotbarSlot | undefined {
    return this.slots[index];
  }

  /** Remaining cooldown of a slot in ms (0 = ready). */
  cooldownRemainingMs(index: number, nowMs: number): number {
    return Math.max(0, (this.cdEnd[index] ?? 0) - nowMs);
  }

  /** 1 right after the skill was used, falling linearly to 0 when ready (drives the radial ring). */
  cooldownFraction(index: number, nowMs: number): number {
    const start = this.cdStart[index] ?? 0;
    const end = this.cdEnd[index] ?? 0;
    if (nowMs >= end || end <= start) return 0;
    return (end - nowMs) / (end - start);
  }

  /** Same shape as `cooldownFraction` for the global cooldown (applies to every slot that uses the GCD). */
  gcdFraction(nowMs: number): number {
    if (nowMs >= this.gcdEnd || this.gcdEnd <= this.gcdStart) return 0;
    return (this.gcdEnd - nowMs) / (this.gcdEnd - this.gcdStart);
  }

  /** Skills with `timing.gcd === false` ignore the global cooldown. */
  usesGcd(index: number): boolean {
    return this.slots[index]?.skill.timing.gcd !== false;
  }

  /** Why the slot cannot be cast right now because of cooldowns, or null when it can (target / range / MP are not checked here). */
  blockedBy(index: number, nowMs: number): CastBlock | null {
    const s = this.slots[index];
    if (!s) return 'empty';
    if (!s.castable) return 'passive';
    if (this.cooldownRemainingMs(index, nowMs) > 0) return 'cooldown';
    if (this.usesGcd(index) && nowMs < this.gcdEnd) return 'gcd';
    return null;
  }

  /** Start the slot's cooldown (and the GCD when it uses it). Call once the cast is accepted. */
  commit(index: number, nowMs: number): void {
    const s = this.slots[index];
    if (!s) return;
    this.cdStart[index] = nowMs;
    this.cdEnd[index] = nowMs + s.skill.timing.cooldown_ms;
    if (this.usesGcd(index)) {
      this.gcdStart = nowMs;
      this.gcdEnd = nowMs + this.gcdMs;
    }
  }

  /** Reset every cooldown (respawn / testing). */
  reset(): void {
    this.cdEnd.fill(0);
    this.cdStart.fill(0);
    this.gcdStart = this.gcdEnd = 0;
  }
}
