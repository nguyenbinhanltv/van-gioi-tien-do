import { Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { character, shared } from './vendor/vgtd.mjs';
import { footprintSortable, newNode, pointSortable, tileToWorld } from './IsoAdapter';
import type { ArtFrames } from './PlaceholderArt';
import type { YSortLayer } from './YSortLayer';
import type { ChibiBody } from './ChibiBody';

let nextId = 1; // id 0 = player

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
  /** Holding Shift plays the walk animation while moving; it does not change the movement speed. */
  walkMode = false;
  /**
   * Play-test PRESENTATION thresholds only (tiles/s, animation selection; they never change movement speed): below
   * WALK_SPEED idle, below RUN_SPEED walk, else run. Temporary client values, see docs/OPEN-ITEMS.md section 15.
   */
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
      const step = PlayerActor.SPEED * frame.magnitude * dt;
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
      // Shift (walkMode) only forces the walk ANIMATION; movement speed is unchanged (no walk speed is specified).
      this.chibi.state(
        speed < PlayerActor.WALK_SPEED ? 'idle' : this.walkMode || speed < PlayerActor.RUN_SPEED ? 'walk' : 'run',
      );
    }
    this.place();
  }

  private place(): void {
    const p = tileToWorld(this.pos.i, this.pos.j);
    this.body.setPosition(p);
    this.shadow.setPosition(p);
  }
}
