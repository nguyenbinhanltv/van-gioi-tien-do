/**
 * Class ids on the wire (D81). The six classes ("Đạo Lộ", docs/11) are the `PathId`s of the skill data; their wire id is the 1-based
 * position in `PATHS` (so a new class appended there gets the next id and old ids never change). 0 means "unknown / not a player class"
 * (monsters and NPCs, and the value old servers sent for players).
 */
import { PATHS, type PathId } from './formulas/skills.js';

/** Class a character gets when it never chose one (the combat default since D75). */
export const DEFAULT_CLASS: PathId = 'kiem';

/** 1..6, stable wire id of a class. */
export function classWireId(path: PathId): number {
  return PATHS.indexOf(path) + 1;
}
/** Inverse of `classWireId`; null for 0 and for any id that is not a class. */
export function pathOfClassWireId(id: number): PathId | null {
  return Number.isInteger(id) && id >= 1 && id <= PATHS.length ? PATHS[id - 1]! : null;
}
/** Validate untrusted input (a hello field): a class path id string, or its wire id as a number; null when it is neither. */
export function parseClass(x: unknown): PathId | null {
  if (typeof x === 'string') return (PATHS as readonly string[]).includes(x) ? (x as PathId) : null;
  if (typeof x === 'number') return pathOfClassWireId(x);
  return null;
}
