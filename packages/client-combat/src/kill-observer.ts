/**
 * Own-kill observer (D84): wraps a `CombatBackend` so a caller can count the player's kills without touching the combat HUD.
 * `ServerCombat` pushes a `death` event only while applying the player's OWN `skill_result` hits (KILL flag, server-confirmed), so
 * counting enemy `death` events here counts kills made by the player's skills. Other events and every property pass through.
 */
import type { CombatBackend } from './backend.js';
import type { CombatEvent } from './mock-combat.js';
import { PLAYER_ID } from './mock-combat.js';

export function withKillObserver(backend: CombatBackend, onKill: (enemyId: number) => void): CombatBackend {
  const watch = (events: CombatEvent[]): CombatEvent[] => {
    for (const ev of events) if (ev.type === 'death' && ev.id !== PLAYER_ID) onKill(ev.id);
    return events;
  };
  return new Proxy(backend, {
    get(target, prop, receiver) {
      if (prop === 'update') return (nowMs: number): CombatEvent[] => watch(target.update(nowMs));
      if (prop === 'cast') return (slot: number, nowMs: number): CombatEvent[] => watch(target.cast(slot, nowMs));
      const v = Reflect.get(target, prop, receiver) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}
