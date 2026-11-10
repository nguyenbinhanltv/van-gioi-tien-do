/**
 * Quest guidance (D125): "where do I go next" for the quest tracker, the edge-of-screen arrow, the minimap marker and the click-to-walk
 * on the tracker. Engine-free: it only reads the `QuestModel`, the player tile and the monsters the server has told the client about.
 * The server stays authoritative (range checks, progress); this only points.
 *
 * Target choice, for the quest the tracker shows first (pinned, then ready, then active; else the first quest that can be accepted):
 *  - can be accepted -> the giver NPC; ready -> the turn-in NPC;
 *  - active -> the first unfinished objective: a talk NPC, the nearest known monster of the kill target (else the middle of the zone it
 *    lives in), the anchor of the zone to reach.
 */
import {
  QUESTS,
  mobDefByKey,
  mobDefById,
  mobZoneAnchor,
  objectiveTarget,
  tileToScreen,
  type MobLayoutZone,
  type QuestObjective,
} from '@vgtd/shared';
import { QuestStatus, npcName, targetName, type QuestModel, type QuestView } from './QuestModel.js';

export interface GuideTile {
  i: number;
  j: number;
}
export type GuideKind = 'npc' | 'mob' | 'zone';
export interface GuideTarget {
  kind: GuideKind;
  tile: GuideTile;
  /** player-facing name of the thing to go to (NPC name, mob name, zone name) */
  label: string;
  questId: string;
  /** the NPC key when `kind` is 'npc' (the dialogue opens for it on arrival) */
  npc?: string;
}
export interface GuideMob {
  defId: number;
  i: number;
  j: number;
}

const dist = (a: GuideTile, b: GuideTile): number => Math.hypot(a.i - b.i, a.j - b.j);

function nearestMob(mobs: Iterable<GuideMob>, from: GuideTile, match: (defId: number) => boolean): GuideTile | null {
  let best: GuideTile | null = null;
  let bd = Infinity;
  for (const m of mobs) {
    if (!match(m.defId)) continue;
    const d = dist(m, from);
    if (d < bd) {
      bd = d;
      best = { i: m.i, j: m.j };
    }
  }
  return best;
}

function npcTarget(model: QuestModel, key: string, mapTiles: number, questId: string): GuideTarget | null {
  const tile = model.npcTile(key, mapTiles);
  return tile ? { kind: 'npc', tile, label: npcName(key), questId, npc: key } : null;
}

function objectiveGuide(
  o: QuestObjective,
  questId: string,
  model: QuestModel,
  mapTiles: number,
  from: GuideTile,
  mobs: Iterable<GuideMob>,
): GuideTarget | null {
  switch (o.kind) {
    case 'talk':
      return npcTarget(model, o.npc, mapTiles, questId);
    case 'reach':
      return { kind: 'zone', tile: mobZoneAnchor(o.zone, mapTiles), label: targetName(o.zone), questId };
    case 'kill': {
      const tier = o.target.startsWith('tier:') ? o.target.slice(5) : null;
      const def = tier ? null : mobDefByKey(o.target);
      const seen = nearestMob(mobs, from, (id) => {
        const d = mobDefById(id);
        return !!d && (tier ? d.tier === tier : d.key === o.target);
      });
      if (seen) return { kind: 'mob', tile: seen, label: targetName(o.target), questId };
      const zone = def?.zone as MobLayoutZone | undefined;
      return zone
        ? { kind: 'zone', tile: mobZoneAnchor(zone, mapTiles), label: targetName(o.target), questId }
        : null;
    }
    default:
      return null; // collect / breakthrough / cultivate: nowhere in particular to walk to
  }
}

/** The quest the guidance follows: the tracker's first, else the first that can be accepted. */
export function guidedQuest(model: QuestModel): QuestView | null {
  return model.tracker(1)[0] ?? model.available()[0] ?? null;
}

/** Where to go for the guided quest, or null when there is nowhere to point (all objectives location-free). */
export function guideTarget(
  model: QuestModel,
  mapTiles: number,
  from: GuideTile | null,
  mobs: Iterable<GuideMob>,
): GuideTarget | null {
  const v = guidedQuest(model);
  if (!v || !from) return null;
  if (v.status === QuestStatus.Available) return npcTarget(model, v.def.giver, mapTiles, v.id);
  if (v.status === QuestStatus.Ready) return npcTarget(model, v.def.turnIn, mapTiles, v.id);
  for (let i = 0; i < v.def.objectives.length; i++) {
    const o = v.def.objectives[i]!;
    if ((v.progress[i] ?? 0) >= objectiveTarget(o)) continue;
    const g = objectiveGuide(o, v.id, model, mapTiles, from, mobs);
    if (g) return g;
  }
  return null;
}

/** The place to stand when walking to a target: an NPC is approached to within reach, anything else is walked onto. */
export function arrivalRadius(t: GuideTarget): number {
  return t.kind === 'npc' ? QUESTS.NPC_RANGE_TILES - 1.5 : 1.5;
}

export interface EdgeArrow {
  /** screen-space angle in radians, 0 = right, +y down (CSS rotation) */
  angle: number;
  /** position in px from the top-left of a `w` x `h` viewport: on the edge ring when the target is off screen */
  x: number;
  y: number;
  /** true when the target tile is inside the viewport (the arrow then sits on it) */
  onScreen: boolean;
}

/**
 * Arrow toward `target` for a viewport `w` x `h` px centred on the player: the target's offset on screen is the iso projection of the tile
 * delta (`shared.tileToScreen`) times `pxPerWorldPx` (the camera zoom times the css px per world px); off screen, the arrow sits on the
 * edge inset by `margin`.
 */
export function edgeArrow(
  from: GuideTile,
  target: GuideTile,
  w: number,
  h: number,
  pxPerWorldPx: number,
  margin = 36,
): EdgeArrow {
  const a = tileToScreen(from.i, from.j);
  const b = tileToScreen(target.i, target.j);
  const dx = (b.x - a.x) * pxPerWorldPx;
  const dy = (b.y - a.y) * pxPerWorldPx;
  const angle = Math.atan2(dy, dx);
  const hx = w / 2 - margin;
  const hy = h / 2 - margin;
  const onScreen = Math.abs(dx) <= hx && Math.abs(dy) <= hy;
  if (onScreen) return { angle, x: w / 2 + dx, y: h / 2 + dy, onScreen };
  const k = Math.min(dx === 0 ? Infinity : hx / Math.abs(dx), dy === 0 ? Infinity : hy / Math.abs(dy));
  return { angle, x: w / 2 + dx * k, y: h / 2 + dy * k, onScreen };
}

/** Distance in whole tiles for the arrow label. */
export const guideDistance = (from: GuideTile, target: GuideTile): number => Math.round(dist(from, target));
