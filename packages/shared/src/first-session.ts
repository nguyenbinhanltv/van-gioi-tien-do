/**
 * First-session loop (D84): the numbers behind the tiny objective tracker that guides a new player through
 * spawn -> field -> kills -> loot -> meditate -> breakthrough. There is no quest system: the tracker is a client-side HUD
 * (`@vgtd/client-core` `FirstSessionTracker`) over state the server already owns (kills from `skill_result`, the bag from
 * `inv_state`, tu vi from `char_state`). All values are PLACEHOLDERS, cần game designer duyệt.
 */
import { MOB_BANDS, mobAreaHalfSize } from './mob-layout.js';

export const FIRST_SESSION = {
  /** objective 2: kills by the player's own skills */
  killTarget: 3,
  /** objective 1 counts as reached this many tiles inside the band edge, so the hint does not flicker at the border */
  fieldMarginTiles: 2,
} as const;

/**
 * Chebyshev distance (tiles) from the map centre at which the field band of normal mobs starts (D83 `MOB_BANDS.normal`) on the
 * default mob layout; the objective "go to the field" is reached beyond this plus `FIRST_SESSION.fieldMarginTiles`.
 */
export function fieldBandStart(mapTiles: number): number {
  return MOB_BANDS.normal.minFrac * mobAreaHalfSize(mapTiles);
}
