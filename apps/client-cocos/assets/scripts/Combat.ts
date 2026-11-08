import { Color, Label, Node, Sprite, SpriteFrame, UITransform, Vec2, game } from 'cc';
import { combat as cb, shared } from './vendor/vgtd.mjs';
import { cellCenterToWorld, newNode, pointSortable, tileToWorld } from './IsoAdapter';
import type { ArtFrames } from './PlaceholderArt';
import type { YSortLayer } from './YSortLayer';
import type { TilePos } from './Actors';
import { OverheadBar, worldUiLayer } from './OverheadBar';

/** ChibiBody class id -> Đạo Lộ (docs/11): picks the hotbar's 8 skills. */
const CLASS_PATH: Record<string, shared.PathId> = {
  'the-tu': 'the',
  'phap-tu': 'phap',
  'dan-phu-tu': 'dan_phu',
  'dao-tu': 'dao',
  'kiem-tu': 'kiem',
  'thuong-tu': 'thuong',
};
/** Nearest walkable tile to a desired point (outward square rings), centred in the tile. */
function walkableNear(walkable: (i: number, j: number) => boolean, i: number, j: number): TilePos {
  const ci = Math.floor(i);
  const cj = Math.floor(j);
  for (let r = 0; r < 12; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) === r && walkable(ci + di, cj + dj)) {
          return { i: ci + di + 0.5, j: cj + dj + 0.5 };
        }
      }
    }
  }
  return { i: ci + 0.5, j: cj + 0.5 };
}

/** Offline backend (`?combat=1`): five mock enemies around the spawn, near to far, the 2nd one hits back. */
export function createMockBackend(
  classId: string,
  spawn: TilePos,
  walkable: (i: number, j: number) => boolean,
  rand: () => number,
): cb.MockCombat {
  const specs: Array<{ name: string; pos: TilePos; fightsBack?: boolean }> = [];
  [3, 4.5, 6, 8, 12].forEach((r, n) => {
    const a = n * 1.9 + 0.4;
    const p = walkableNear(walkable, spawn.i + Math.cos(a) * r, spawn.j + Math.sin(a) * r);
    specs.push({ name: n === 1 ? 'Hung nhan (hits back)' : `Moc nhan ${n + 1}`, pos: p, fightsBack: n === 1 });
  });
  return new cb.MockCombat({ path: pathOfClass(classId), enemies: specs, rand, playerPos: spawn });
}

export const pathOfClass = (classId: string): shared.PathId => CLASS_PATH[classId] ?? 'kiem';

/** Placeholder icon colour per element (visual only; real icons come with the art pipeline). */
const ELEMENT_COLOR: Record<string, Color> = {
  kim: new Color(190, 190, 205, 255),
  moc: new Color(90, 170, 90, 255),
  thuy: new Color(70, 130, 215, 255),
  hoa: new Color(215, 90, 60, 255),
  tho: new Color(170, 130, 80, 255),
  loi: new Color(200, 180, 60, 255),
  phong: new Color(110, 200, 190, 255),
  root_main: new Color(150, 110, 200, 255),
  none: new Color(120, 120, 120, 255),
};

const BLOCK_TEXT: Record<string, string> = {
  empty: 'empty slot',
  passive: 'passive skill',
  cooldown: 'on cooldown',
  gcd: 'global cooldown',
  busy: 'casting',
  mp: 'not enough MP',
  no_target: 'no target',
  range: 'out of range',
  dead: 'you are down',
};

const SLOT = 56;
const GAP = 6;
const BAR_W = 240;
const BAR_H = 14;
const HUD_W = cb.HOTBAR_SLOTS * (SLOT + GAP) - GAP;

function initials(id: string): string {
  return id
    .split('_')
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

function quad(parent: Node, name: string, frame: SpriteFrame, w: number, h: number, color: Color): Sprite {
  const n = newNode(name, parent);
  n.addComponent(UITransform).setContentSize(w, h);
  const sp = n.addComponent(Sprite);
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  sp.spriteFrame = frame;
  sp.color = color;
  return sp;
}

function text(parent: Node, name: string, size: number, color: Color): Label {
  const n = newNode(name, parent);
  n.addComponent(UITransform);
  const l = n.addComponent(Label);
  l.fontSize = size;
  l.lineHeight = size + 2;
  l.horizontalAlign = Label.HorizontalAlign.CENTER;
  l.verticalAlign = Label.VerticalAlign.CENTER;
  l.overflow = Label.Overflow.NONE;
  l.color = color;
  return l;
}

interface SlotUi {
  root: Node;
  bg: Sprite;
  cd: Sprite;
  gcd: Sprite;
  cdText: Label;
  /** Centre of the slot in the HUD root's local space (for pointer hit tests). */
  x: number;
}

interface Floater {
  node: Node;
  label: Label;
  age: number;
  life: number;
  vy: number;
  baseColor: Color;
}

/**
 * P3 client groundwork: combat HUD skeleton driven by an OFFLINE mock combat loop (`@vgtd/client-combat`), enabled with `?combat=1`
 * so it works before server combat exists. Skills come from the class kit in `@vgtd/shared` (D49); all numbers in the mock are
 * placeholders, see packages/client-combat/src/mock-combat.ts.
 *
 * - hotbar: the class's 8 skills (keys 1-8, tap/click), cooldown ring + GCD ring, passives dimmed, blocked-cast flash + reason
 * - HP / MP bars (+ shield) bottom centre, cast bar, target frame top centre
 * - target: click an enemy (via client-core's `pickEntity`), Tab / Shift+Tab cycle, Esc clears; ring on the target's tile
 * - floating damage / heal / shield numbers above the entity (crit = bigger and yellow)
 * - mock enemies: stationary dummies plus one that hits back; placeholder sprites in the L3 Y-sort layer
 */
export class CombatUi {
  readonly backend: cb.CombatBackend;
  private readonly ysort: YSortLayer;
  private readonly hudRoot: Node;
  private readonly slots: SlotUi[] = [];
  private readonly hpFill: Sprite;
  private readonly mpFill: Sprite;
  private readonly shieldFill: Sprite;
  private readonly hpText: Label;
  private readonly mpText: Label;
  private readonly castBar: Sprite;
  private readonly toast: Label;
  private toastLeft = 0;
  private readonly targetRoot: Node;
  private readonly targetName: Label;
  private readonly targetFill: Sprite;
  private readonly targetText: Label;
  private readonly ring: Node;
  private readonly enemyNodes = new Map<number, Node>();
  private readonly enemyBars = new Map<number, OverheadBar>();
  private readonly selfBar: OverheadBar;
  private readonly worldUi: Node;
  private readonly deathRoot: Node;
  private readonly deathCount: Label;
  private diedAtMs: number | null = null;
  /** Touch input: the skill wheel replaces the bottom hotbar (hidden, not tappable). */
  private touchMode = false;
  private readonly floaters: Floater[] = [];
  private readonly flash = new Map<number, number>();
  private clock = 0;
  private scale = 1;
  private readonly keyDown: (e: KeyboardEvent) => void;
  private readonly pointerDown: (e: PointerEvent) => void;
  private readonly pointerMove: (e: PointerEvent) => void;
  private lastPointer: { x: number; y: number } | null = null;

  constructor(
    hudParent: Node,
    worldRoot: Node,
    ysort: YSortLayer,
    private readonly art: ArtFrames,
    /** Where combat is resolved: `createMockBackend(...)` (offline `?combat=1`) or a `cb.ServerCombat` (online, server-authoritative). */
    backend: cb.CombatBackend,
    private readonly playerPos: () => TilePos,
    private readonly clientToUi: (x: number, y: number) => { x: number; y: number },
    /** client px -> shared logical screen coordinates (y down), for the aim point */
    private readonly clientToScreen: (x: number, y: number) => { x: number; y: number },
  ) {
    this.backend = backend;
    this.ysort = ysort;

    const l1 = worldRoot.getChildByName('L1_Decal') ?? worldRoot;
    this.ring = newNode('TargetRing', l1);
    this.ring.addComponent(UITransform).setContentSize(shared.TILE_WIDTH, shared.TILE_HEIGHT);
    const rs = this.ring.addComponent(Sprite);
    rs.sizeMode = Sprite.SizeMode.CUSTOM;
    rs.spriteFrame = art.marker;
    rs.color = new Color(255, 70, 70, 255);
    this.ring.active = false;
    // --- HUD
    this.hudRoot = newNode('CombatHud', hudParent);
    const bars = SLOT + 8 + BAR_H;
    const hp = this.makeBar('Hp', -BAR_W / 2 - 5, bars, new Color(200, 50, 50, 255));
    const mp = this.makeBar('Mp', BAR_W / 2 + 5, bars, new Color(60, 110, 220, 255));
    this.hpFill = hp.fill;
    this.mpFill = mp.fill;
    this.hpText = hp.label;
    this.mpText = mp.label;
    this.shieldFill = quad(hp.back, 'Shield', art.pixel, 0, 4, new Color(240, 240, 255, 255));
    this.shieldFill.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    this.shieldFill.node.setPosition(-BAR_W / 2, BAR_H / 2 - 2, 0);
    const cast = this.makeBar('Cast', 0, bars + BAR_H + 6, new Color(240, 200, 80, 255), HUD_W, 6);
    this.castBar = cast.fill;
    cast.back.active = false;
    this.castBackNode = cast.back;
    this.toast = text(this.hudRoot, 'Toast', 16, new Color(255, 220, 160, 255));
    this.toast.node.setPosition(0, bars + BAR_H + 34, 0);

    const bar = this.backend.hotbar;
    bar.slots.forEach((s, i) => {
      const x = -HUD_W / 2 + SLOT / 2 + i * (SLOT + GAP);
      const root = newNode(`Slot${i + 1}`, this.hudRoot);
      root.setPosition(x, SLOT / 2, 0);
      const base = ELEMENT_COLOR[s.skill.element] ?? ELEMENT_COLOR.none!;
      const bgColor = s.castable ? base : new Color(base.r * 0.45, base.g * 0.45, base.b * 0.45, 255);
      const bg = quad(root, 'Bg', art.pixel, SLOT, SLOT, bgColor);
      quad(root, 'Frame', art.pixel, SLOT - 4, SLOT - 4, new Color(0, 0, 0, 70));
      const name = text(root, 'Name', 16, new Color(255, 255, 255, s.castable ? 255 : 150));
      name.string = initials(s.skill.id);
      const key = text(root, 'Key', 11, new Color(255, 255, 255, 230));
      key.string = String(i + 1);
      key.node.setPosition(-SLOT / 2 + 8, SLOT / 2 - 8, 0);
      const tier = text(root, 'Tier', 9, new Color(255, 255, 255, 170));
      tier.string = s.castable ? s.skill.tier[0]!.toUpperCase() : 'P';
      tier.node.setPosition(SLOT / 2 - 7, -SLOT / 2 + 7, 0);
      const cd = quad(root, 'Cd', art.pixel, SLOT, SLOT, new Color(0, 0, 0, 175));
      this.radial(cd);
      const gcd = quad(root, 'Gcd', art.pixel, SLOT, SLOT, new Color(255, 255, 255, 75));
      this.radial(gcd);
      const cdText = text(root, 'CdText', 18, new Color(255, 255, 255, 255));
      this.slots.push({ root, bg, cd, gcd, cdText, x });
    });

    // target frame (top centre)
    this.targetRoot = newNode('TargetFrame', this.hudRoot);
    const tf = this.makeBar('Target', 0, 0, new Color(200, 80, 80, 255), 260, 16, this.targetRoot);
    this.targetFill = tf.fill;
    this.targetText = tf.label;
    this.targetName = text(this.targetRoot, 'TargetName', 16, new Color(255, 235, 235, 255));
    this.targetName.node.setPosition(0, 20, 0);
    this.targetRoot.active = false;

    // floating text pool (world space, above the Y-sorted entities)
    const l6 = worldUiLayer(worldRoot);
    this.worldUi = l6;
    this.selfBar = new OverheadBar(l6, art.pixel, 96);
    for (let n = 0; n < 24; n++) {
      const label = text(l6, `Float${n}`, 22, new Color(255, 255, 255, 255));
      label.node.active = false;
      this.floaters.push({
        node: label.node,
        label,
        age: 0,
        life: 0,
        vy: 0,
        baseColor: new Color(255, 255, 255, 255),
      });
    }

    // death overlay: full-screen dim + title + respawn countdown, shown while the backend says the player is dead
    this.deathRoot = newNode('DeathOverlay', hudParent);
    quad(this.deathRoot, 'Dim', art.pixel, 4000, 4000, new Color(60, 0, 0, 120));
    const title = text(this.deathRoot, 'Title', 40, new Color(255, 225, 225, 255));
    title.string = 'Ban da roi / You have fallen';
    title.node.setPosition(0, 40, 0);
    this.deathCount = text(this.deathRoot, 'Count', 24, new Color(255, 235, 200, 255));
    this.deathCount.node.setPosition(0, -10, 0);
    this.deathRoot.active = false;

    this.keyDown = (e) => this.onKey(e);
    window.addEventListener('keydown', this.keyDown);
    // pointerdown on a hotbar slot casts it and must not also start click-to-move (client-core listens on the same canvas)
    this.pointerDown = (e) => this.onPointer(e);
    game.canvas?.addEventListener('pointerdown', this.pointerDown, { capture: true });
    // aim = where the pointer is (ground / direction skills); touch has no hover, so the aim stays unset there
    this.pointerMove = (e) => {
      this.lastPointer = { x: e.clientX, y: e.clientY };
    };
    game.canvas?.addEventListener('pointermove', this.pointerMove);
    this.layout(1280, 720);
    // automation hook (scripts/combat-smoke.mjs): read the mock state without touching the DOM / canvas pixels
    (globalThis as unknown as Record<string, unknown>).__vgtdCombat = {
      state: () => ({
        path: this.backend.hotbar.path,
        target: this.backend.target.current,
        hp: this.backend.player.hp,
        hpMax: this.backend.player.hpMax,
        mp: this.backend.player.mp,
        mpMax: this.backend.player.mpMax,
        enemies: this.backend.enemies.map((e) => ({
          id: e.id,
          hp: e.hp,
          hpMax: e.hpMax,
          alive: e.alive,
          i: e.pos.i,
          j: e.pos.j,
        })),
        slots: this.backend.hotbar.slots.map((s, i) => ({
          id: s.skill.id,
          castable: s.castable,
          cdMs: this.backend.hotbar.cooldownRemainingMs(i, this.clock),
        })),
        gcd: this.backend.hotbar.gcdFraction(this.clock),
        floaters: this.floaters.filter((f) => f.node.active).length,
        touchMode: this.touchMode,
        hotbarShown: this.slots.every((s) => s.root.active),
        deathOverlay: this.deathRoot.active,
        deathText: this.deathCount.string,
        selfBar: this.selfBar.visible,
        enemyBars: [...this.enemyBarIds()].filter((id) => this.enemyBars.get(id)!.visible),
      }),
      /** Automation only (scripts/combat-online-smoke.mjs): feed own vitals as the snapshot would, to exercise the death flow. */
      fakeVitals: (hp: number, hpMax: number) => {
        const b = this.backend as { setSelfVitals?: (v: object) => void };
        const pl = this.backend.player;
        b.setSelfVitals?.({ hp, hpMax, mp: pl.mp, mpMax: pl.mpMax, alive: hp > 0 });
      },
    };
  }

  private castBackNode: Node;

  /** Called by InputManager (`pickEntity`): tile under the click -> enemy id, trying the body (above the foot) too. */
  pick(tile: TilePos): number | null {
    const targets = this.backend.enemies;
    const sel = this.backend.target;
    const hit = sel.pickAt(targets, tile, 0.9);
    if (hit !== null) return hit;
    // the sprite stands ~1 tile above its foot: look one tile-height further down the screen
    const s = shared.tileToScreen(tile.i, tile.j);
    const t2 = shared.screenToTile(s.x, s.y + 40);
    return sel.pickAt(targets, t2, 0.9);
  }

  /** Re-anchor to the canvas size (design units). */
  layout(canvasW: number, canvasH: number): void {
    this.scale = Math.min(1, (canvasW - 16) / HUD_W);
    this.hudRoot.setScale(this.scale, this.scale, 1);
    this.hudRoot.setPosition(0, -canvasH / 2 + 10, 0);
    this.targetRoot.setPosition(0, (canvasH - 20) / this.scale - 70, 0);
    this.deathRoot.setPosition(0, 0, 0);
  }

  /** Mock targets picked by InputManager arrive as `frame.target`; call once per frame after polling input. */
  update(dt: number, frameTarget: number | null): void {
    this.clock += dt * 1000;
    const now = this.clock;
    if (frameTarget !== null) this.backend.target.select(frameTarget);
    this.backend.setPlayerPos(this.playerPos());
    if (this.backend.setAim) {
      const lp = this.lastPointer;
      if (lp) {
        const s = this.clientToScreen(lp.x, lp.y);
        this.backend.setAim(shared.screenToTile(s.x, s.y));
      }
    }
    for (const ev of this.backend.update(now)) this.onEvent(ev);
    this.refresh(now, dt);
  }

  private castSlot(i: number): void {
    for (const ev of this.backend.cast(i, this.clock)) this.onEvent(ev);
  }

  /** Now (HUD clock, ms): the same clock the hotbar cooldowns use. */
  get nowMs(): number {
    return this.clock;
  }

  /** Touch input: show the skill wheel instead of the bottom hotbar. */
  setTouchMode(on: boolean): void {
    this.touchMode = on;
    for (const s of this.slots) s.root.active = !on;
  }

  /**
   * A cast from the touch skill wheel. Wheel slot 0 = the basic attack = hotbar slot 0, slot k = hotbar slot k; wheel slots past the
   * hotbar are empty. `aim` (tile coordinates) comes from dragging the button; without it the server picks the nearest / selected target.
   */
  castFromWheel(slot: number, aim?: { i: number; j: number }): void {
    for (const ev of this.backend.cast(slot, this.clock, aim)) this.onEvent(ev);
  }

  /** What the wheel button of hotbar `slot` shows: label, colour, readiness and cooldown overlays. null = no such slot. */
  slotView(slot: number): {
    label: string;
    color: Color;
    castable: boolean;
    cd: number;
    gcd: number;
    cdText: string;
    rangeTiles: number;
    shape: { type: string; radius?: number };
  } | null {
    const bar = this.backend.hotbar;
    const s = bar.slots[slot];
    if (!s) return null;
    const base = ELEMENT_COLOR[s.skill.element] ?? ELEMENT_COLOR.none!;
    const left = bar.cooldownRemainingMs(slot, this.clock) / 1000;
    return {
      label: initials(s.skill.id),
      color: base,
      castable: s.castable,
      cd: bar.cooldownFraction(slot, this.clock),
      gcd: s.castable && bar.usesGcd(slot) ? bar.gcdFraction(this.clock) : 0,
      cdText: left > 0 ? (left >= 10 ? String(Math.ceil(left)) : left.toFixed(1)) : '',
      rangeTiles: s.skill.targeting.range_tiles ?? 0,
      shape: s.skill.shape,
    };
  }

  private onKey(e: KeyboardEvent): void {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const m = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
    if (m) {
      this.castSlot(Number(m[1]) - 1);
      e.preventDefault();
    } else if (e.code === 'Tab') {
      this.backend.target.cycle(this.backend.enemies, this.playerPos(), 15, e.shiftKey);
      e.preventDefault();
    } else if (e.code === 'Escape') {
      this.backend.target.clear();
    }
  }

  private onPointer(e: PointerEvent): void {
    if (this.touchMode) return; // the skill wheel (SkillWheel.ts) owns touch casting
    if (e.button !== 0) return;
    const ui = this.clientToUi(e.clientX, e.clientY);
    const lx = ui.x / this.scale;
    const ly = (ui.y - this.hudRoot.position.y) / this.scale;
    if (ly < 0 || ly > SLOT) return;
    const i = this.slots.findIndex((s) => Math.abs(lx - s.x) <= SLOT / 2);
    if (i < 0) return;
    this.castSlot(i);
    e.stopImmediatePropagation();
    e.preventDefault();
  }

  private onEvent(ev: cb.CombatEvent): void {
    switch (ev.type) {
      case 'damage': {
        const onPlayer = ev.targetId === cb.PLAYER_ID;
        this.spawnText(
          ev.targetId,
          ev.crit ? `${ev.amount}!` : String(ev.amount),
          onPlayer
            ? new Color(255, 90, 90, 255)
            : ev.crit
              ? new Color(255, 215, 60, 255)
              : new Color(255, 255, 255, 255),
          ev.crit ? 32 : 22,
        );
        break;
      }
      case 'heal':
        this.spawnText(ev.targetId, `+${ev.amount}`, new Color(110, 235, 130, 255), 22);
        break;
      case 'shield':
        this.spawnText(ev.targetId, `+${ev.amount}`, new Color(170, 200, 255, 255), 22);
        break;
      case 'blocked':
        this.flash.set(ev.slot, 0.25);
        this.toast.string = BLOCK_TEXT[ev.reason] ?? ev.reason;
        this.toastLeft = 1.2;
        break;
      case 'death':
        if (ev.id === cb.PLAYER_ID) {
          this.diedAtMs = this.clock;
          this.toastLeft = 0;
        }
        break;
      case 'respawn':
        if (ev.id === cb.PLAYER_ID) {
          this.diedAtMs = null;
          this.toast.string = 'Hoi sinh / Respawned';
          this.toastLeft = 2.5;
        }
        break;
      default:
        break;
    }
  }

  private spawnText(entityId: number, str: string, color: Color, size: number): void {
    const pos = entityId === cb.PLAYER_ID ? this.playerPos() : (this.backend.enemy(entityId)?.pos ?? null);
    if (!pos) return;
    const f =
      this.floaters.find((x) => !x.node.active) ??
      this.floaters.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
    f.node.active = true;
    f.label.string = str;
    f.label.fontSize = size;
    f.label.lineHeight = size + 2;
    f.baseColor = color;
    f.age = 0;
    f.life = 1;
    f.vy = 48;
    const base = tileToWorld(pos.i, pos.j);
    f.node.setPosition(base.x + (((this.clock + entityId * 37) % 40) - 20), base.y + 78, 0);
  }

  private refresh(now: number, dt: number): void {
    const p = this.backend.player;
    const frac = (v: number, max: number): number => (max > 0 ? Math.max(0, Math.min(1, v / max)) : 0);
    this.setBar(this.hpFill, BAR_W, frac(p.hp, p.hpMax));
    this.setBar(this.mpFill, BAR_W, frac(p.mp, p.mpMax));
    this.hpText.string = `${Math.ceil(p.hp)} / ${Math.round(p.hpMax)}`;
    this.mpText.string = `${Math.ceil(p.mp)} / ${Math.round(p.mpMax)}`;
    this.shieldFill.node.getComponent(UITransform)!.setContentSize(BAR_W * frac(p.shield, p.hpMax), 4);

    const bar = this.backend.hotbar;
    const gcd = bar.gcdFraction(now);
    this.slots.forEach((s, i) => {
      const slot = bar.slots[i]!;
      const cd = bar.cooldownFraction(i, now);
      s.cd.fillRange = cd;
      s.cd.node.active = cd > 0;
      const useGcd = slot.castable && bar.usesGcd(i);
      s.gcd.fillRange = useGcd ? gcd : 0;
      s.gcd.node.active = useGcd && gcd > 0;
      const left = bar.cooldownRemainingMs(i, now) / 1000;
      s.cdText.string = left > 0 ? (left >= 10 ? String(Math.ceil(left)) : left.toFixed(1)) : '';
      const fl = this.flash.get(i) ?? 0;
      if (fl > 0) this.flash.set(i, fl - dt);
      s.root.setScale(fl > 0 ? 1.08 : 1, fl > 0 ? 1.08 : 1, 1);
    });

    const c = p.casting;
    const castMs = c ? c.endsAt - c.startedAt : 0;
    this.castBackNode.active = !!c && castMs > 0;
    if (c && castMs > 0) this.setBar(this.castBar, HUD_W, Math.min(1, (now - c.startedAt) / castMs));

    this.toastLeft -= dt;
    this.toast.node.active = this.toastLeft > 0;

    // target frame + ring + enemy visibility
    const tid = this.backend.target.current;
    const t = tid === null ? undefined : this.backend.enemy(tid);
    this.targetRoot.active = !!t;
    this.ring.active = !!t;
    if (t) {
      this.targetName.string = t.name;
      this.setBar(this.targetFill, 260, frac(t.hp, t.hpMax));
      this.targetText.string = `${Math.ceil(t.hp)} / ${t.hpMax}`;
      this.ring.setPosition(cellCenterToWorld(Math.floor(t.pos.i), Math.floor(t.pos.j)));
    }
    this.syncEnemyNodes();
    this.updateOverheads(dt, tid);
    this.updateDeathOverlay();

    for (const f of this.floaters) {
      if (!f.node.active) continue;
      f.age += dt;
      if (f.age >= f.life) {
        f.node.active = false;
        continue;
      }
      const pos = f.node.position;
      f.node.setPosition(pos.x, pos.y + f.vy * dt, 0);
      const a = Math.round(255 * (1 - Math.max(0, (f.age - 0.5) / 0.5)));
      f.label.color = new Color(f.baseColor.r, f.baseColor.g, f.baseColor.b, a);
    }
  }

  /**
   * One placeholder sprite per enemy the backend knows (mock dummies, or mobs the server shows); created on first sight, moved to the
   * backend position every frame, hidden while dead and removed when the backend forgets the enemy.
   */
  private syncEnemyNodes(): void {
    const seen = new Set<number>();
    for (const e of this.backend.enemies) {
      seen.add(e.id);
      let n = this.enemyNodes.get(e.id);
      if (!n) {
        n = newNode(`Enemy${e.id}`);
        n.addComponent(UITransform).setContentSize(48, 72);
        n.getComponent(UITransform)!.setAnchorPoint(0.5, 0.06);
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.spriteFrame = this.art.player;
        const hostile = (e as { fightsBack?: boolean }).fightsBack === true;
        sp.color = hostile ? new Color(235, 90, 90, 255) : new Color(225, 205, 130, 255);
        const id = e.id;
        const key = 3000 + (id % 100000);
        this.ysort.add(n, () => {
          const cur = this.backend.enemy(id);
          return pointSortable(key, 0, cur?.pos.i ?? 0, cur?.pos.j ?? 0);
        });
        this.enemyNodes.set(id, n);
      }
      n.setPosition(tileToWorld(e.pos.i, e.pos.j));
      n.active = e.alive;
    }
    this.enemyNodes.forEach((n, id) => {
      if (seen.has(id)) return;
      this.ysort.remove(n); // unregisters only: destroy the node here
      n.destroy();
      this.enemyNodes.delete(id);
    });
  }

  private enemyBarIds(): number[] {
    const ids: number[] = [];
    this.enemyBars.forEach((_b, id) => ids.push(id));
    return ids;
  }

  /** Overhead bars: the own one above the character, one per enemy (shown while targeted or just hurt). */
  private updateOverheads(dt: number, targetId: number | null): void {
    const p = this.backend.player;
    const pos = this.playerPos();
    this.selfBar.place(pos.i, pos.j);
    this.selfBar.update(dt * 1000, { hp: p.hp, hpMax: p.hpMax, alive: p.alive, kind: 'self' });
    for (const e of this.backend.enemies) {
      let b = this.enemyBars.get(e.id);
      if (!b) {
        b = new OverheadBar(this.worldUi, this.art.pixel, 84);
        this.enemyBars.set(e.id, b);
      }
      b.place(e.pos.i, e.pos.j);
      b.update(dt * 1000, { hp: e.hp, hpMax: e.hpMax, alive: e.alive, kind: 'enemy', targeted: e.id === targetId });
    }
    this.enemyBars.forEach((b, id) => {
      if (this.backend.enemy(id)) return;
      b.destroy();
      this.enemyBars.delete(id);
    });
  }

  /** While dead: dim the screen and count down the server's respawn delay (the server respawns; the overlay waits for `alive`). */
  private updateDeathOverlay(): void {
    const dead = !this.backend.player.alive;
    this.deathRoot.active = dead;
    if (!dead) {
      this.diedAtMs = null;
      return;
    }
    if (this.diedAtMs === null) this.diedAtMs = this.clock; // joined dead / backend without the event
    const left = cb.respawnLeftMs(this.diedAtMs, this.clock, this.backend.respawnDelayMs);
    const secs = Math.ceil(left / 1000);
    this.deathCount.string =
      left > 0 ? `Hoi sinh sau ${secs} giay / Respawn in ${secs} s` : 'Dang hoi sinh... / Respawning...';
  }

  private setBar(fill: Sprite, full: number, fraction: number): void {
    const ui = fill.node.getComponent(UITransform)!;
    ui.setContentSize(Math.max(0, full * fraction), ui.contentSize.height);
  }

  private radial(sp: Sprite): void {
    sp.type = Sprite.Type.FILLED;
    sp.fillType = Sprite.FillType.RADIAL;
    sp.fillCenter = new Vec2(0.5, 0.5);
    sp.fillStart = 0.25; // 12 o'clock
    sp.fillRange = 0;
  }

  private makeBar(
    name: string,
    x: number,
    y: number,
    color: Color,
    w = BAR_W,
    h = BAR_H,
    parent: Node = this.hudRoot,
  ): { back: Node; fill: Sprite; label: Label } {
    const back = quad(parent, `${name}Back`, this.art.pixel, w, h, new Color(0, 0, 0, 170));
    back.node.setPosition(x, y, 0);
    const fill = quad(back.node, `${name}Fill`, this.art.pixel, w, h - 2, color);
    fill.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    fill.node.setPosition(-w / 2, 0, 0);
    const label = text(back.node, `${name}Text`, 11, new Color(255, 255, 255, 255));
    return { back: back.node, fill, label };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    game.canvas?.removeEventListener('pointerdown', this.pointerDown, { capture: true });
    game.canvas?.removeEventListener('pointermove', this.pointerMove);
  }
}
