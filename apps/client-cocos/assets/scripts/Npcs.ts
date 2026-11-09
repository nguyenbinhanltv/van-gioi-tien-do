import { Color, Node, Sprite, UITransform } from 'cc';
import { character } from './vendor/vgtd.mjs';
import { newNode, pointSortable, tileToWorld } from './IsoAdapter';
import { CHIBI_CLASSES, ChibiBody } from './ChibiBody';
import type { ArtFrames } from './PlaceholderArt';
import type { YSortLayer } from './YSortLayer';
import { CHIBI_REACH } from './CullMath';
import type { TilePos } from './Actors';

/** Scene nodes of one NPC: `body` goes into the L3 Y-sort layer, `shadow` into L2. */
export interface NpcBody {
  body: Node;
  shadow: Node;
  /** Set when the body is a chibi armature: the crowd drives its facing and idle/walk clip. */
  chibi?: ChibiBody;
}

/**
 * Builds the visual of NPC number `n`. `chibiNpcBody` (default) uses the real semi-chibi armatures, cycling through the
 * six classes, so the P1 exit criterion ("20 NPC") is measured with real art; `placeholderBody` is the cheap sprite
 * (`?npcart=placeholder`). Nothing else in the crowd depends on what the body looks like.
 */
export type NpcBodyFactory = (n: number, art: ArtFrames, shadowLayer: Node) => NpcBody;

function npcShadow(n: number, art: ArtFrames, shadowLayer: Node): Node {
  const shadow = newNode(`Npc${n}Shadow`, shadowLayer);
  const sui = shadow.addComponent(UITransform);
  sui.setContentSize(48, 24);
  const ssp = shadow.addComponent(Sprite);
  ssp.sizeMode = Sprite.SizeMode.CUSTOM;
  ssp.spriteFrame = art.shadow;
  return shadow;
}

/** Chibi armature body, class = n modulo the six classes (mixed crowd). */
export function chibiNpcBody(n: number, art: ArtFrames, shadowLayer: Node): NpcBody {
  const chibi = new ChibiBody(newNode(`NpcHolder${n}`));
  chibi.setClass(CHIBI_CLASSES[n % CHIBI_CLASSES.length]!.id);
  return { body: chibi.root, shadow: npcShadow(n, art, shadowLayer), chibi };
}

export function placeholderBody(n: number, art: ArtFrames, shadowLayer: Node): NpcBody {
  const body = newNode(`Npc${n}`);
  const ui = body.addComponent(UITransform);
  ui.setContentSize(48, 72);
  ui.setAnchorPoint(0.5, 0.06);
  const sp = body.addComponent(Sprite);
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  sp.spriteFrame = art.player;
  sp.color = new Color(120 + ((n * 47) % 135), 120 + ((n * 91) % 135), 120 + ((n * 133) % 135), 255);
  return { body, shadow: npcShadow(n, art, shadowLayer) };
}

interface Npc extends NpcBody {
  id: number;
  facing: string;
  pos: TilePos;
  target: TilePos | null;
  wait: number;
}

/**
 * A crowd of wandering NPCs for the P1 perf harness (docs/10 section 12: >= 30 FPS with 20 NPC). Each NPC walks to a random
 * walkable tile near its spawn, idles for a while and repeats. Movement is axis-separated like the player, so a
 * blocked tile makes it slide / re-pick instead of getting stuck. Not simulation code: it uses the injected `rand`
 * only (no Math.random), so the same seed gives the same crowd.
 */
export class NpcCrowd {
  /** tiles per second (placeholder, slower than the player). */
  static readonly SPEED = 2.2;
  private readonly npcs: Npc[] = [];

  constructor(
    count: number,
    ysort: YSortLayer,
    shadowLayer: Node,
    art: ArtFrames,
    private readonly walkable: (i: number, j: number) => boolean,
    private readonly around: TilePos,
    private readonly rand: () => number,
    private readonly radius = 24,
    makeBody: NpcBodyFactory = chibiNpcBody,
  ) {
    for (let n = 0; n < count; n++) {
      const { body, shadow, chibi } = makeBody(n, art, shadowLayer);
      const id = 1000 + n; // id 0 = player, props use a small counter
      const pos = this.pickTile() ?? { ...around };
      const npc: Npc = { id, body, shadow, chibi, facing: 'S', pos, target: null, wait: this.rand() * 2 };
      this.npcs.push(npc);
      ysort.add(body, () => pointSortable(id, 0, npc.pos.i, npc.pos.j), CHIBI_REACH);
      this.place(npc);
    }
  }

  get count(): number {
    return this.npcs.length;
  }

  /** NPC tile positions (for tests / the perf log). */
  positions(): TilePos[] {
    return this.npcs.map((n) => ({ ...n.pos }));
  }

  update(dt: number): void {
    for (const n of this.npcs) {
      if (!n.target) {
        n.chibi?.state('idle');
        n.wait -= dt;
        if (n.wait <= 0) n.target = this.pickTile();
        continue;
      }
      const di = n.target.i - n.pos.i;
      const dj = n.target.j - n.pos.j;
      const dist = Math.hypot(di, dj);
      const step = NpcCrowd.SPEED * dt;
      if (dist <= step) {
        n.pos = { ...n.target };
        n.target = null;
        n.chibi?.state('idle');
        n.wait = 0.5 + this.rand() * 3;
      } else {
        if (n.chibi) {
          n.facing = character.directionFromTileVector(di / dist, dj / dist, n.facing as never);
          n.chibi.face(n.facing as never);
          n.chibi.state('walk');
        }
        const ni = n.pos.i + (di / dist) * step;
        const nj = n.pos.j + (dj / dist) * step;
        let moved = false;
        if (this.walkable(Math.floor(ni), Math.floor(n.pos.j))) {
          n.pos.i = ni;
          moved = true;
        }
        if (this.walkable(Math.floor(n.pos.i), Math.floor(nj))) {
          n.pos.j = nj;
          moved = true;
        }
        if (!moved) {
          n.target = null; // blocked: idle, then pick a new target
          n.wait = 0.3;
        }
      }
      this.place(n);
    }
  }

  private pickTile(): TilePos | null {
    for (let tries = 0; tries < 20; tries++) {
      const i = Math.floor(this.around.i + (this.rand() * 2 - 1) * this.radius);
      const j = Math.floor(this.around.j + (this.rand() * 2 - 1) * this.radius);
      if (this.walkable(i, j)) return { i: i + 0.5, j: j + 0.5 };
    }
    return null;
  }

  private place(n: Npc): void {
    const p = tileToWorld(n.pos.i, n.pos.j);
    n.body.setPosition(p);
    n.shadow.setPosition(p);
  }
}
