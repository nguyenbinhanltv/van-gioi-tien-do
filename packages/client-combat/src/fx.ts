/**
 * Combat readability helpers shared by the offline and online HUD (engine-free, pure): which overhead HP bars to show and how they look,
 * the respawn countdown, and `VitalsWatcher`, which turns the server's own vitals (snapshot `self.vitals`, sent when they change) into the
 * floating-number / death / respawn events the HUD already understands. The server decides everything; this only presents it.
 */
import { COMBAT_RULES } from '@vgtd/shared';
import type { CombatEvent } from './mock-combat.js';
import { PLAYER_ID } from './mock-combat.js';

/** Overhead bar of an entity: hidden at full HP unless targeted, hidden for the dead, fades out after the last hit. */
export interface OverheadBarState {
  visible: boolean;
  /** 0..1 */
  fraction: number;
  /** 0..1 opacity */
  alpha: number;
  tone: 'self' | 'ally' | 'enemy' | 'target';
}

export const OVERHEAD_BAR = {
  /** how long a bar stays up after the entity was last hurt (ms) */
  LINGER_MS: 4000,
  /** fade-out at the end of the linger (ms) */
  FADE_MS: 600,
} as const;

export interface OverheadBarInput {
  hp: number;
  hpMax: number;
  alive?: boolean;
  /** the local player's bar is always up while hurt; `ally` = another player; `enemy` = monster */
  kind: 'self' | 'ally' | 'enemy';
  targeted?: boolean;
  /** ms since the entity last lost HP (Infinity / undefined = never seen hurt) */
  sinceHurtMs?: number;
}

export function overheadBar(i: OverheadBarInput): OverheadBarState {
  const fraction = i.hpMax > 0 ? Math.max(0, Math.min(1, i.hp / i.hpMax)) : 0;
  const tone: OverheadBarState['tone'] = i.targeted ? 'target' : i.kind;
  if (i.alive === false || fraction <= 0) return { visible: false, fraction: 0, alpha: 0, tone };
  if (i.targeted) return { visible: true, fraction, alpha: 1, tone };
  const hurt = fraction < 1;
  const since = i.sinceHurtMs ?? Infinity;
  // own bar: up whenever hurt (you need to see it); others: only for a while after being hit
  if (!hurt) return { visible: false, fraction, alpha: 0, tone };
  if (i.kind === 'self') return { visible: true, fraction, alpha: 1, tone };
  if (since >= OVERHEAD_BAR.LINGER_MS) return { visible: false, fraction, alpha: 0, tone };
  const fadeStart = OVERHEAD_BAR.LINGER_MS - OVERHEAD_BAR.FADE_MS;
  const alpha = since <= fadeStart ? 1 : Math.max(0, 1 - (since - fadeStart) / OVERHEAD_BAR.FADE_MS);
  return { visible: alpha > 0, fraction, alpha, tone };
}

/** Milliseconds until the server respawns a player who died at `diedAtMs` (the client clock); never negative. */
export function respawnLeftMs(diedAtMs: number, nowMs: number, delayMs: number = COMBAT_RULES.RESPAWN_PVE_MS): number {
  return Math.max(0, diedAtMs + delayMs - nowMs);
}

export interface Vitals {
  hp: number;
  hpMax: number;
  alive: boolean;
}

/**
 * Compares consecutive own-vitals samples. A drop is damage taken (a floating number above the player), a rise is healing, death and
 * respawn are their own events (a respawn refills HP, which must not show as a heal). The first sample is only a baseline.
 */
export class VitalsWatcher {
  private last: Vitals | null = null;
  /** Client-clock time of the last loss of HP (feeds the overhead bar linger). */
  lastHurtAtMs = -Infinity;
  /** Client-clock time of the current death, or null while alive. */
  diedAtMs: number | null = null;

  feed(v: Vitals, nowMs: number): CombatEvent[] {
    const prev = this.last;
    this.last = { hp: v.hp, hpMax: v.hpMax, alive: v.alive };
    const out: CombatEvent[] = [];
    if (!prev) {
      if (!v.alive) this.diedAtMs = nowMs;
      return out;
    }
    const delta = Math.round(v.hp - prev.hp);
    if (delta < 0) {
      this.lastHurtAtMs = nowMs;
      out.push({ type: 'damage', targetId: PLAYER_ID, amount: -delta, crit: false, sourceId: 0, atMs: nowMs });
    } else if (delta > 0 && prev.alive && v.alive && v.hpMax === prev.hpMax) {
      out.push({ type: 'heal', targetId: PLAYER_ID, amount: delta, atMs: nowMs });
    }
    if (prev.alive && !v.alive) {
      this.diedAtMs = nowMs;
      out.push({ type: 'death', id: PLAYER_ID, atMs: nowMs });
    } else if (!prev.alive && v.alive) {
      this.diedAtMs = null;
      out.push({ type: 'respawn', id: PLAYER_ID, atMs: nowMs });
    }
    return out;
  }
}
