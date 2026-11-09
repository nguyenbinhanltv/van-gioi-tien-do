import { BlendFactor, Node, Sprite, UITransform, UIOpacity, game } from 'cc';
import { newNode } from './IsoAdapter';
import { getParticleFrame, preloadParticles } from './PropArt';
import { particleSpec } from './ArtRegistry';

/**
 * Demo effect for the PART 2 particle textures: a short flourish when the server reports a higher stage (breakthrough or
 * sub-stage up): a star flare, an expanding ring and a handful of sparks flying out, all additive. Pure client decoration: it only
 * reads what the progression view already shows and never sends anything. Does nothing when the particle art was not generated.
 */

const DURATION = 1.1;
const SPARKS = 8;

interface Puff {
  node: Node;
  opacity: UIOpacity;
  /** start / end draw size (design px) */
  s0: number;
  s1: number;
  /** velocity (design px / s) for sparks, 0 for the flare and ring */
  vx: number;
  vy: number;
  delay: number;
  /** peak opacity 0..1 (the glow orb is a near-solid white disc: kept translucent so the realm badge under it stays visible) */
  peak: number;
}

export class LevelUpFx {
  private puffs: Puff[] = [];
  private t = 0;
  private active = false;

  constructor(private readonly parent: Node) {
    // the particle page is not in the initial download: fetch it a few seconds after the HUD exists (long before a first level-up)
    setTimeout(() => void preloadParticles(), 4000);
  }

  /** Start the flourish centred on (x, y) in `parent`-local design px. Restarts when already playing. */
  play(x: number, y: number): void {
    this.clear();
    const make = (name: string, spriteName: string, p: Omit<Puff, 'node' | 'opacity'>): void => {
      const frame = getParticleFrame(spriteName);
      if (!frame) return;
      const node = newNode(name, this.parent);
      node.setPosition(x, y, 0);
      node.addComponent(UITransform).setContentSize(p.s0, p.s0);
      const sp = node.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      sp.spriteFrame = frame;
      if (particleSpec(spriteName)?.blend === 'additive') {
        sp.srcBlendFactor = BlendFactor.SRC_ALPHA;
        sp.dstBlendFactor = BlendFactor.ONE;
      }
      const opacity = node.addComponent(UIOpacity);
      opacity.opacity = 0;
      this.puffs.push({ node, opacity, ...p });
    };
    make('FxGlow', 'p_spark', { s0: 50, s1: 150, vx: 0, vy: 0, delay: 0, peak: 0.9 });
    make('FxRing', 'p_ring', { s0: 20, s1: 190, vx: 0, vy: 0, delay: 0.08, peak: 0.9 });
    for (let k = 0; k < SPARKS; k++) {
      const a = (k / SPARKS) * Math.PI * 2 + 0.3;
      const speed = 70 + (k % 3) * 22;
      make('FxSpark' + k, 'p_spark', {
        s0: 26,
        s1: 10,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        delay: 0.05,
        peak: 1,
      });
    }
    this.t = 0;
    this.active = this.puffs.length > 0;
  }

  get playing(): boolean {
    return this.active;
  }

  /** Advance by `dt` seconds (default: the frame time). */
  update(dt: number = game.deltaTime): void {
    if (!this.active) return;
    this.t += dt;
    for (const p of this.puffs) {
      const k = (this.t - p.delay) / (DURATION - p.delay);
      if (k < 0) continue;
      if (k >= 1) {
        p.opacity.opacity = 0;
        continue;
      }
      const ease = 1 - (1 - k) * (1 - k);
      const size = p.s0 + (p.s1 - p.s0) * ease;
      p.node.getComponent(UITransform)!.setContentSize(size, size);
      p.node.setPosition(p.node.position.x + p.vx * dt, p.node.position.y + p.vy * dt, 0);
      // quick fade in, long fade out
      p.opacity.opacity = Math.round(255 * p.peak * Math.min(1, k * 8) * (1 - k) * (1 - k * 0.2));
    }
    if (this.t >= DURATION) this.clear();
  }

  clear(): void {
    for (const p of this.puffs) p.node.destroy();
    this.puffs = [];
    this.active = false;
  }
}
