import { Color, Node, Sprite, UITransform } from 'cc';
import { shared } from './vendor/vgtd.mjs';
import { newNode, tileToWorld } from './IsoAdapter';
import { getParticleFrame, preloadParticles } from './PropArt';
import { PARTICLE_NAMES } from './ArtRegistry';
import { ParticlePool } from './ParticleSim';
import { type FxPlace, VfxPlayer, makePool, trailTravelS } from './VfxPlayer';
import { type ResolvedVfx, type SkillLike, resolveVfx } from './SkillVfxPresets';

/**
 * INTERIM skill VFX (client decoration only: it reads cast / hit events the combat HUD already receives and never sends anything).
 * The preset table (SkillVfxPresets.ts) decides what each class / archetype throws; the simulation is ParticleSim.ts + VfxPlayer.ts
 * (engine-free, tested); this file is the thin Cocos view: one node group with one pre-built Sprite per pool slot, created once. Per
 * frame it only moves, resizes and recolours the live ones: no node creation, no allocation. All sprites use the one particle atlas
 * page and normal alpha blending (Cocos 3.8 Sprite has no per-sprite blend factors; additive needs a custom material, an open item),
 * so the whole effect layer is one batch.
 */
export class SkillVfx {
  private readonly root: Node;
  private readonly player: VfxPlayer;
  private readonly view: PoolView;
  /** reused placement + colour scratch objects (no per-cast allocation) */
  private readonly place: FxPlace = { x: 0, y: 0, dx: 1, dy: 0, tx: 0, ty: 0, diameter: 0 };
  /** design px of one tile step along i, and the ground ellipse semi-axes of a circle of radius 1 tile (derived from the iso projection) */
  private readonly stepPx: number;
  private readonly rx: number;
  private readonly asked = { value: false };

  constructor(layer: Node) {
    this.root = newNode('Vfx', layer);
    this.root.setSiblingIndex(0); // under the floating damage numbers and overhead bars of the same layer
    this.player = new VfxPlayer(makePool());
    this.view = new PoolView(this.root, 'VfxParticles', this.player.pool);
    const o = tileToWorld(0, 0);
    const a = tileToWorld(1, 0);
    const b = tileToWorld(0, 1);
    this.stepPx = Math.hypot(a.x - o.x, a.y - o.y);
    this.rx = Math.hypot(a.x - o.x, b.x - o.x); // ground circle of radius 1 tile: semi-axis along screen x
  }

  /** The particle page is not in the initial download; ask for it the first time an effect is played. */
  private ensureArt(): void {
    if (this.asked.value) return;
    this.asked.value = true;
    void preloadParticles();
  }

  /**
   * A cast finished: play the skill's archetype. `from` = caster tile, `to` = target tile (enemy / aim) or null (direction skills
   * without a target fire along `dir`, a unit vector in world px, or a default one).
   */
  cast(
    path: string,
    classElement: string,
    skill: SkillLike,
    from: { i: number; j: number },
    to: { i: number; j: number } | null,
  ): ResolvedVfx {
    this.ensureArt();
    const vfx = resolveVfx(path, classElement, skill);
    const f = tileToWorld(from.i, from.j);
    const range = (skill.targeting.range_tiles ?? 3) * this.stepPx;
    let tx: number, ty: number;
    if (to) {
      const t = tileToWorld(to.i, to.j);
      tx = t.x;
      ty = t.y;
    } else {
      tx = f.x + 0.894 * range;
      ty = f.y - 0.447 * range;
    }
    const len = Math.hypot(tx - f.x, ty - f.y) || 1;
    const p = this.place;
    p.dx = (tx - f.x) / len;
    p.dy = (ty - f.y) / len;
    p.diameter = 2 * (skill.shape.radius ?? 1.5) * this.rx;
    switch (vfx.archetype) {
      case 'trail': {
        p.x = f.x;
        p.y = f.y + CHEST;
        p.tx = tx;
        p.ty = ty + CHEST;
        break;
      }
      case 'ring': {
        // circle around the caster (self) or the target / aim point (ground)
        const centre = skill.targeting.mode === 'self' || !to ? { x: f.x, y: f.y } : { x: tx, y: ty };
        p.x = centre.x;
        p.y = centre.y;
        break;
      }
      case 'aura':
        p.x = f.x;
        p.y = f.y + CHEST * 0.6;
        break;
      default: {
        // burst = melee swing: in front of the caster
        p.x = f.x + p.dx * this.stepPx * 1.1;
        p.y = f.y + CHEST + p.dy * this.stepPx * 0.55;
      }
    }
    this.player.cast(vfx, p);
    return vfx;
  }

  /**
   * An enemy was hit by the player's last cast (`vfx` from `cast`): impact burst at `at`. `travelFrom` (the caster tile) delays the burst
   * by the trail's travel time so it lands when the streak arrives.
   */
  hit(vfx: ResolvedVfx, at: { i: number; j: number }, travelFrom: { i: number; j: number } | null): void {
    this.ensureArt();
    const t = tileToWorld(at.i, at.j);
    const p = this.place;
    p.x = t.x;
    p.y = t.y + CHEST;
    p.dx = 0;
    p.dy = 1;
    p.diameter = 0;
    let delay = 0;
    if (travelFrom && vfx.archetype === 'trail') {
      const f = tileToWorld(travelFrom.i, travelFrom.j);
      delay = trailTravelS(Math.hypot(t.x - f.x, t.y - f.y));
    }
    this.player.hit(vfx, p, delay);
  }

  update(dt: number): void {
    if (this.player.count === 0 && !this.view.dirty) return;
    this.player.step(dt);
    this.view.sync();
  }

  /** Live particles (tests / debug). */
  get live(): number {
    return this.player.count;
  }

  /** Stops everything at once (scene change / respawn). */
  clear(): void {
    this.player.clear();
    this.view.sync();
  }
}

/** Chest height above the feet, design px. */
const CHEST = 44;

/** One pre-built Sprite node per pool slot, in one group (= one batch: one texture page, normal alpha blending). */
class PoolView {
  private readonly nodes: Node[] = [];
  private readonly sprites: Sprite[] = [];
  private readonly uis: UITransform[] = [];
  private readonly texOf: number[] = [];
  private readonly shown: boolean[] = [];
  private readonly color = new Color(255, 255, 255, 255);
  /** true while a sync may still have nodes to hide */
  dirty = false;

  constructor(
    parent: Node,
    name: string,
    private readonly pool: ParticlePool,
  ) {
    const group = newNode(name, parent);
    for (let i = 0; i < pool.capacity; i++) {
      const n = newNode('p', group);
      n.active = false;
      this.uis.push(n.addComponent(UITransform));
      const sp = n.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      this.nodes.push(n);
      this.sprites.push(sp);
      this.texOf.push(-1);
      this.shown.push(false);
    }
  }

  sync(): void {
    const pool = this.pool;
    let any = false;
    for (let i = 0; i < pool.capacity; i++) {
      const live = pool.alive(i);
      const node = this.nodes[i]!;
      if (!live) {
        if (this.shown[i]) {
          node.active = false;
          this.shown[i] = false;
        }
        continue;
      }
      const tex = pool.tex[i]!;
      const sp = this.sprites[i]!;
      if (this.texOf[i] !== tex) {
        const frame = getParticleFrame(PARTICLE_NAMES[tex]!);
        if (!frame) {
          // the particle page has not arrived yet: keep the particle invisible, it simply ages out
          if (this.shown[i]) {
            node.active = false;
            this.shown[i] = false;
          }
          continue;
        }
        sp.spriteFrame = frame;
        this.texOf[i] = tex;
      }
      any = true;
      if (!this.shown[i]) {
        node.active = true;
        this.shown[i] = true;
      }
      const s = pool.size(i);
      this.uis[i]!.setContentSize(s, s * pool.sq[i]!);
      node.setPosition(pool.x[i]!, pool.y[i]!, 0);
      node.angle = pool.rot[i]!;
      this.color.set(pool.r[i]!, pool.g[i]!, pool.b[i]!, pool.opacity(i));
      sp.color = this.color;
    }
    this.dirty = any || pool.count > 0;
  }
}

/** The element of a class (Đạo Lộ id), from the shared class table. */
export function classElementOf(path: string): string {
  return shared.classOf(path as shared.PathId).element;
}
