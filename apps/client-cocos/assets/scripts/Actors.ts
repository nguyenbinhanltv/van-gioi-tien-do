import { Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { character, shared } from './vendor/vgtd.mjs';
import { footprintSortable, newNode, pointSortable, tileToWorld } from './IsoAdapter';
import type { ArtFrames } from './PlaceholderArt';
import type { YSortLayer } from './YSortLayer';
import { CHIBI_REACH } from './CullMath';
import { ChibiBody } from './ChibiBody';
import { OverheadBar, worldUiLayer } from './OverheadBar';

let nextId = 1; // id 0 = player

/** Next unique id for a draw-order key (tie-breaker of the L3 Y-sort); 0 = the player. */
export function allocSortId(): number {
  return nextId++;
}

export type TilePos = { i: number; j: number };

function spriteNode(name: string, frame: SpriteFrame, w: number, h: number, ax: number, ay: number): Node {
  const n = newNode(name);
  const ui = n.addComponent(UITransform);
  ui.setContentSize(w, h);
  ui.setAnchorPoint(ax, ay);
  const sp = n.addComponent(Sprite);
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  sp.spriteFrame = frame;
  return n;
}

/** Placeholder static prop (tree / rock) standing on one tile; depth = its foot (tile S edge). */
export function addProp(ysort: YSortLayer, art: ArtFrames, kind: 'tree' | 'rock', ti: number, tj: number): void {
  const frame = kind === 'tree' ? art.tree : art.rock;
  const [w, h] = kind === 'tree' ? [80, 112] : [56, 40];
  const n = spriteNode(`${kind}${ti},${tj}`, frame, w, h, 0.5, 0.06);
  const id = nextId++;
  n.setPosition(tileToWorld(ti + 0.5, tj + 0.5));
  const key = footprintSortable(id, 0, ti, tj);
  ysort.add(n, () => key);
}

/**
 * Controllable placeholder character. Position is a continuous tile coord (i, j); the node is
 * placed via IsoAdapter. Movement consumes the engine-agnostic InputFrame from client-core
 * (click-to-move A* path, WASD or touch joystick all arrive as `frame.move` / `frame.magnitude`).
 *
 * `body` is the semi-chibi DragonBones armature (`ChibiBody`) when given, else the placeholder sprite. Facing comes from the
 * tile-space move vector (8 directions, 5 authored + mirror); idle/walk/run from the real moved speed.
 */
export class PlayerActor {
  /** tiles per second at full input magnitude (placeholder; real value comes from server stats). */
  static readonly SPEED = 4.5;
  pos: TilePos;
  readonly body: Node;
  readonly shadow: Node;
  private facingRight = true;
  /** Holding Shift walks: PLAY-TEST ONLY, speed scaled by WALK_SPEED_FACTOR (see below). */
  walkMode = false;
  /**
   * PLAY-TEST ONLY placeholders, not specified by the docs (docs/08 section 4 gives only the move speed formula; I-08 in
   * docs/31 tracks 4.5 tiles/s as a placeholder): Shift walk mode speed factor, and the idle/walk/run animation thresholds
   * (tiles/s: below WALK_SPEED idle, below RUN_SPEED walk, else run). Pending design: docs/OPEN-ITEMS.md section 15.
   */
  static readonly WALK_SPEED_FACTOR = 0.5;
  static readonly WALK_SPEED = 0.3;
  static readonly RUN_SPEED = 3.2;
  private facing: shared.Direction = 'S';

  constructor(
    ysort: YSortLayer,
    shadowLayer: Node,
    art: ArtFrames,
    start: TilePos,
    private readonly walkable: (i: number, j: number) => boolean,
    private readonly chibi: ChibiBody | null = null,
  ) {
    this.pos = { ...start };
    this.body = chibi ? chibi.root : spriteNode('Player', art.player, 48, 72, 0.5, 0.06);
    this.shadow = spriteNode('PlayerShadow', art.shadow, 48, 24, 0.5, 0.5);
    shadowLayer.addChild(this.shadow);
    ysort.add(this.body, () => pointSortable(0, 0, this.pos.i, this.pos.j));
    this.place();
  }

  position(): TilePos {
    return this.pos;
  }

  update(dt: number, frame: { move: TilePos; magnitude: number }): void {
    let speed = 0; // tiles/s actually moved this frame
    if (frame.magnitude > 0) {
      const step = PlayerActor.SPEED * frame.magnitude * (this.walkMode ? PlayerActor.WALK_SPEED_FACTOR : 1) * dt;
      const oi = this.pos.i,
        oj = this.pos.j;
      const ni = this.pos.i + frame.move.i * step;
      const nj = this.pos.j + frame.move.j * step;
      // axis-separated so the player slides along blocked tiles instead of sticking
      if (this.walkable(Math.floor(ni), Math.floor(this.pos.j))) this.pos.i = ni;
      if (this.walkable(Math.floor(this.pos.i), Math.floor(nj))) this.pos.j = nj;
      speed = dt > 0 ? Math.hypot(this.pos.i - oi, this.pos.j - oj) / dt : 0;
      if (this.chibi) {
        this.facing = character.directionFromTileVector(frame.move.i, frame.move.j, this.facing);
      } else {
        // placeholder: only the horizontal mirror
        const dx = (frame.move.i - frame.move.j) * shared.TILE_HALF_WIDTH; // screen-x of the move vector
        if (Math.abs(dx) > 1e-3) {
          this.facingRight = dx > 0;
          this.body.setScale(this.facingRight ? 1 : -1, 1, 1);
        }
      }
    }
    if (this.chibi) {
      this.chibi.face(this.facing);
      this.chibi.state(
        speed < PlayerActor.WALK_SPEED ? 'idle' : this.walkMode || speed < PlayerActor.RUN_SPEED ? 'walk' : 'run',
      );
    }
    this.place();
  }

  /**
   * Online mode: the position comes from client-side prediction (client-core NetClient), not from local integration.
   * Facing and idle/walk/run are derived from how far the drawn position actually moved this frame.
   */
  followNet(p: TilePos, dt: number): void {
    const di = p.i - this.pos.i;
    const dj = p.j - this.pos.j;
    const speed = dt > 0 ? Math.hypot(di, dj) / dt : 0;
    this.pos = { i: p.i, j: p.j };
    if (this.chibi) {
      if (speed >= PlayerActor.WALK_SPEED) this.facing = character.directionFromTileVector(di, dj, this.facing);
      this.chibi.face(this.facing);
      this.chibi.state(
        speed < PlayerActor.WALK_SPEED ? 'idle' : this.walkMode || speed < PlayerActor.RUN_SPEED ? 'walk' : 'run',
      );
    } else if (Math.abs(di - dj) > 1e-4) {
      this.body.setScale(di - dj > 0 ? 1 : -1, 1, 1);
    }
    this.place();
  }

  private place(): void {
    const p = tileToWorld(this.pos.i, this.pos.j);
    this.body.setPosition(p);
    this.shadow.setPosition(p);
  }
}

/**
 * Another player, driven by interpolated snapshots (client-core RemoteWorld). The wire carries no class yet, so the
 * body class is derived from the entity id (docs/OPEN-ITEMS.md); the model is the same ChibiBody the local player uses.
 */
export class RemotePlayer {
  pos: TilePos;
  readonly body: Node;
  private readonly shadow: Node;
  private readonly chibi: ChibiBody;
  private facing: shared.Direction = 'S';
  private readonly bar: OverheadBar | null;

  constructor(
    private readonly ysort: YSortLayer,
    shadowLayer: Node,
    art: ArtFrames,
    readonly entityId: number,
    /** chibi class id (art) this remote player is drawn with */
    readonly classId: string,
    start: TilePos,
  ) {
    this.pos = { ...start };
    this.chibi = new ChibiBody(newNode('ChibiHolder'));
    this.chibi.setClass(classId);
    this.body = this.chibi.root;
    this.shadow = spriteNode(`RemoteShadow${entityId}`, art.shadow, 48, 24, 0.5, 0.5);
    shadowLayer.addChild(this.shadow);
    ysort.add(this.body, () => pointSortable(entityId, 0, this.pos.i, this.pos.j), CHIBI_REACH);
    this.bar = shadowLayer.parent ? new OverheadBar(worldUiLayer(shadowLayer.parent), art.pixel, 96) : null;
    this.place();
  }

  /** `hpPct` (0-100, from the snapshot) drives the overhead bar; omit it to leave the bar hidden. */
  update(p: TilePos, dirIndex: number, speed: number, hpPct?: number, dtMs = 16): void {
    this.pos = { i: p.i, j: p.j };
    this.facing = shared.DIRECTIONS[dirIndex] ?? this.facing;
    this.chibi.face(this.facing);
    this.chibi.state(speed < PlayerActor.WALK_SPEED ? 'idle' : speed < PlayerActor.RUN_SPEED ? 'walk' : 'run');
    this.place();
    if (this.bar && hpPct !== undefined) {
      this.bar.place(this.pos.i, this.pos.j);
      this.bar.update(dtMs, { hp: hpPct, hpMax: 100, kind: 'ally' });
    }
  }

  destroy(): void {
    this.bar?.destroy();
    this.ysort.remove(this.body);
    this.shadow.destroy();
    this.body.destroy();
  }

  private place(): void {
    const p = tileToWorld(this.pos.i, this.pos.j);
    this.body.setPosition(p);
    this.shadow.setPosition(p);
  }
}
