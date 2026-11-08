/**
 * What the combat HUD reads and does, independent of where combat is resolved: `MockCombat` (offline, `?combat=1`) and `ServerCombat`
 * (server-authoritative results, online mode) both implement it, so the HUD never knows which one it talks to.
 */
import type { Hotbar } from './hotbar.js';
import type { CombatEvent } from './mock-combat.js';
import type { TargetSelector, Targetable, TilePoint } from './targeting.js';

export interface PlayerView extends Targetable {
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  shield: number;
  /** The cast in progress (drives the cast bar), or null. */
  casting: { slot: number; startedAt: number; endsAt: number } | null;
}

export interface EnemyView extends Targetable {
  name: string;
  hp: number;
  hpMax: number;
}

export interface CombatBackend {
  readonly hotbar: Hotbar;
  readonly target: TargetSelector;
  readonly player: PlayerView;
  readonly enemies: readonly EnemyView[];
  enemy(id: number): EnemyView | undefined;
  /** Tell the backend where the local player is (target range, Tab cycling). */
  setPlayerPos(p: TilePoint): void;
  /** Request a cast of a hotbar slot. Returns the immediate events (`cast_start`, or `blocked` with a reason). */
  cast(slot: number, nowMs: number): CombatEvent[];
  /** Advance to `nowMs`; returns the events since the last call. */
  update(nowMs: number): CombatEvent[];
}
