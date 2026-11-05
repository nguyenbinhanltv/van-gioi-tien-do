import { Node, Sprite, UITransform, game } from 'cc';
import { core, shared } from './vendor/vgtd.mjs';
import { newNode } from './IsoAdapter';
import type { ArtFrames } from './PlaceholderArt';
import type { CameraRig } from './CameraRig';
import type { TilePos } from './Actors';

type InputFrame = ReturnType<InstanceType<typeof core.InputManager>['poll']>;

/**
 * Glue between @vgtd/client-core (InputManager, IsoPathfinder, AnchorLayout) and Cocos:
 *  - InputManager listens on the game canvas (Pointer Events; mouse click-to-move + WASD, touch joystick)
 *  - AnchorLayout (client-core) computes the touch layout from the container size
 *  - the floating joystick is drawn from `touch.visualState()` with two placeholder sprites
 * `?input=touch` / `?input=pointer` forces the mode (useful for desktop testing).
 */
export class InputBridge {
  readonly input: InstanceType<typeof core.InputManager>;
  readonly layout: InstanceType<typeof core.AnchorLayout>;
  private readonly joyBase: Node;
  private readonly joyKnob: Node;

  constructor(
    private readonly rig: CameraRig,
    grid: { width: number; height: number; isWalkable(i: number, j: number): boolean },
    player: { position(): TilePos },
    art: ArtFrames,
    hudRoot: Node,
  ) {
    const canvas = game.canvas as HTMLCanvasElement;
    const q = new URLSearchParams(location.search).get('input');
    const forcedMode = q === 'touch' || q === 'pointer' ? q : null;
    this.input = new core.InputManager(canvas, { grid, camera: rig, player, forcedMode });

    this.layout = new core.AnchorLayout(canvas.parentElement!);
    const applyLayout = (res: core.LayoutResult) => {
      const tl = core.touchLayoutFromRects(res, 1 / shared.TILE_WIDTH); // aim-drag: ~1 tile per TILE_WIDTH screen px at zoom 1 (approximation, not exact iso metric)
      if (tl) this.input.setTouchLayout(tl);
    };
    this.layout.on('layout', applyLayout);
    this.layout.setMode(this.input.mode);
    this.input.on('modeChange', (m: core.InputMode) => this.layout.setMode(m));

    this.joyBase = this.makeSprite('JoyBase', art.joyBase, hudRoot);
    this.joyKnob = this.makeSprite('JoyKnob', art.joyKnob, hudRoot);
  }

  private makeSprite(name: string, frame: ArtFrames['joyBase'], parent: Node): Node {
    const n = newNode(name, parent);
    n.addComponent(UITransform);
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.spriteFrame = frame;
    n.active = false;
    return n;
  }

  /** Call once per frame before simulating the player. */
  poll(): InputFrame {
    return this.input.poll();
  }

  /** Draw the floating joystick (touch mode) in HUD space. */
  updateVisuals(): void {
    const v = this.input.touch.visualState();
    const joy = v?.joystick;
    this.joyBase.active = this.joyKnob.active = !!joy;
    if (!joy) return;
    const r = game.canvas!.getBoundingClientRect();
    const ui = this.rig.clientToUi(r.left + joy.base.x, r.top + joy.base.y);
    const kn = this.rig.clientToUi(r.left + joy.knob.x, r.top + joy.knob.y);
    const unit = this.rig.clientToUi(r.left + 1, r.top).x - this.rig.clientToUi(r.left, r.top).x; // design units per css px
    const k = Number.isFinite(unit) && unit > 0 ? unit : 1;
    const base = this.joyBase.getComponent(UITransform)!;
    base.setContentSize(joy.radius * 2 * k, joy.radius * 2 * k);
    this.joyBase.setPosition(ui.x, ui.y, 0);
    const knob = this.joyKnob.getComponent(UITransform)!;
    knob.setContentSize(joy.radius * k, joy.radius * k);
    this.joyKnob.setPosition(kn.x, kn.y, 0);
  }

  /** Target tile of the click-to-move path currently being walked (for the destination marker). */
  destination(frame: InputFrame): TilePos | null {
    const p = frame.path;
    return p && p.length > 0 ? p[p.length - 1] : null;
  }

  destroy(): void {
    this.input.destroy();
    this.layout.destroy();
  }
}
