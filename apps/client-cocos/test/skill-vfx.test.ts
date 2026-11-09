import { describe, it, expect } from 'vitest';
import { skillDefinitions } from '@vgtd/shared';
import { PARTICLE_NAMES } from '../assets/scripts/ArtRegistry';
import { ParticlePool, VfxRng } from '../assets/scripts/ParticleSim';
import {
  CLASS_OVERRIDES,
  ELEMENT_COLORS,
  ELEMENT_TEX,
  FLAVOUR,
  type SkillLike,
  archetypeOf,
  resolveVfx,
  unknownTextures,
} from '../assets/scripts/SkillVfxPresets';
import { type FxPlace, POOL_CAPACITY, VfxPlayer, makePool, trailTravelS } from '../assets/scripts/VfxPlayer';

const skills = skillDefinitions.skills as unknown as Array<SkillLike & { path: string; kind: string }>;
const active = skills.filter((s) => s.kind === 'active');
const place = (over: Partial<FxPlace> = {}): FxPlace => ({
  x: 0,
  y: 0,
  dx: 1,
  dy: 0,
  tx: 100,
  ty: 0,
  diameter: 200,
  ...over,
});
const classElement = (path: string) => skillDefinitions.classes.find((c) => c.path === path)!.element;

describe('preset table', () => {
  it('only uses registered particle textures', () => {
    expect(unknownTextures()).toEqual([]);
  });
  it('has a flavour for every class (Dao Lo) and a colour set for every element a skill can have', () => {
    for (const c of skillDefinitions.classes) expect(FLAVOUR[c.path], c.path).toBeTruthy();
    for (const s of skills)
      if (s.element !== 'root_main' && s.element !== 'none') expect(ELEMENT_COLORS[s.element], s.element).toBeTruthy();
    for (const e of Object.keys(ELEMENT_COLORS)) expect(ELEMENT_TEX[e], e).toBeTruthy();
    for (const k of Object.keys(CLASS_OVERRIDES)) expect(FLAVOUR[k], k).toBeTruthy();
  });
  it('picks the archetype from what the skill does', () => {
    const by = (id: string) => skills.find((s) => s.id === id)!;
    expect(archetypeOf(by('linh_quang_thuan'))).toBe('aura'); // shield, no damage
    expect(archetypeOf(by('hoi_xuan_chu'))).toBe('aura'); // heal
    expect(archetypeOf(by('thien_hoa_luu_tinh'))).toBe('ring'); // ground circle
    expect(archetypeOf(by('long_ho_quyen'))).toBe('ring'); // self circle
    expect(archetypeOf(by('kinh_loi_thich'))).toBe('trail'); // line
    expect(archetypeOf(by('kiem_khi_tram'))).toBe('burst'); // melee cone
    const proj = skills.find((s) => s.vfx?.projectile_fx && s.effects.some((e) => e.type === 'damage'))!;
    expect(archetypeOf(proj)).toBe(proj.shape.type === 'circle' ? 'ring' : 'trail');
  });
  it('resolves every active skill of every class to non-empty effects with a colour', () => {
    const seen = new Map<string, Set<string>>();
    for (const s of active) {
      const v = resolveVfx(s.path, classElement(s.path), s);
      expect(v.cast.length, s.id).toBeGreaterThan(0);
      expect(v.hit.length, s.id).toBeGreaterThan(0);
      expect(v.primary.length).toBe(3);
      for (const d of [...v.cast, ...v.hit]) {
        expect(d.count).toBeGreaterThan(0);
        expect(d.life).toBeGreaterThan(0);
        expect(d.alpha).toBeGreaterThan(0);
        expect(d.alpha).toBeLessThanOrEqual(1);
      }
      if (!seen.has(s.path)) seen.set(s.path, new Set());
      seen.get(s.path)!.add(v.archetype);
    }
    expect([...seen.keys()].sort()).toEqual(skillDefinitions.classes.map((c) => c.path).sort());
  });
  it('uses the class element for root_main / none skills, and the skill element texture when it differs from the class', () => {
    const base = {
      shape: { type: 'single' },
      targeting: { mode: 'enemy', range_tiles: 6 },
      effects: [{ type: 'damage' }],
    };
    const own = resolveVfx('thuong', 'loi', { id: 'x_own', element: 'root_main', ...base });
    expect(own.element).toBe('loi');
    expect(own.primary).toEqual(ELEMENT_COLORS.loi!.primary);
    // (a path without stills: the generic presets, whose main texture follows the element; classes with stills draw their own art)
    const ice = resolveVfx('generic_path', 'moc', { id: 'x_ice', element: 'thuy', ...base });
    expect(ice.element).toBe('thuy');
    expect(ice.cast.some((d) => d.tex === 'p_ice')).toBe(true);
    expect(ice.primary).toEqual(ELEMENT_COLORS.thuy!.primary);
  });
});

describe('ParticlePool', () => {
  const spawn = (p: ParticlePool, delay = 0, life = 1) =>
    p.spawn(0, 1, 2, 10, 0, 0, 0, delay, life, 10, 20, 1, 0, 0, 255, 128, 0, 1);
  it('delays birth, moves, fades and releases', () => {
    const p = new ParticlePool(4);
    const i = spawn(p, 0.5, 1);
    expect(p.count).toBe(1);
    p.step(0.25);
    expect(p.alive(i)).toBe(false); // still waiting
    expect(p.x[i]).toBeCloseTo(1);
    p.step(0.5); // born 0.25 s ago
    expect(p.alive(i)).toBe(true);
    expect(p.x[i]).toBeCloseTo(1 + 10 * 0.25, 4);
    expect(p.opacity(i)).toBeGreaterThan(0);
    expect(p.size(i)).toBeGreaterThan(10);
    p.step(2);
    expect(p.count).toBe(0);
    expect(p.used[i]).toBe(0);
  });
  it('recycles the oldest claim when full instead of failing', () => {
    const p = new ParticlePool(3);
    for (let n = 0; n < 5; n++) spawn(p);
    expect(p.count).toBe(3);
    p.clear();
    expect(p.count).toBe(0);
  });
  it('rise and drag integrate only the lifetime', () => {
    const p = new ParticlePool(2);
    const i = p.spawn(0, 0, 0, 0, 0, 100, 0, 0, 2, 10, 10, 1, 0, 0, 1, 1, 1, 1);
    p.step(1);
    expect(p.y[i]).toBeGreaterThan(0);
  });
  it('fades in quickly and ends transparent', () => {
    const p = new ParticlePool(1);
    const i = spawn(p, 0, 1);
    p.step(0.02);
    const early = p.opacity(i);
    p.step(0.2);
    const mid = p.opacity(i);
    p.step(0.75);
    const late = p.opacity(i);
    expect(early).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(early);
    expect(late).toBeLessThan(mid);
  });
});

describe('VfxPlayer', () => {
  it('emits every texture into the one pool and recycles when it is full (capacity is fixed)', () => {
    const pl = new VfxPlayer(makePool());
    pl.emit({ tex: 'p_smoke', count: 3, life: 1, size: [10, 20], tint: 'primary', alpha: 1 }, [1, 2, 3], place());
    pl.emit({ tex: 'p_flame', count: 2, life: 1, size: [10, 20], tint: 'primary', alpha: 1 }, [1, 2, 3], place());
    expect(pl.count).toBe(5);
    pl.emit(
      { tex: 'p_spark', count: POOL_CAPACITY * 2, life: 1, size: [10, 20], tint: 'primary', alpha: 1 },
      [1, 2, 3],
      place(),
    );
    expect(pl.count).toBe(POOL_CAPACITY);
  });
  it('sweeps a trail along the segment with staggered births, and sizes rings from the diameter', () => {
    const pl = new VfxPlayer(makePool());
    pl.emit(
      { tex: 'p_slash', count: 5, life: 1, size: [10, 10], along: true, stagger: 0.1, tint: 'primary', alpha: 1 },
      [0, 0, 0],
      place({ tx: 400 }),
    );
    const a = pl.pool;
    const xs = [...a.x.slice(0, 5)];
    expect(xs[0]).toBeCloseTo(0);
    expect(xs[4]).toBeCloseTo(400);
    expect(a.age[3]).toBeCloseTo(-0.3);
    pl.emit(
      { tex: 'p_ring', count: 1, life: 1, size: [0.2, 1], fit: 'diameter', squash: 0.5, tint: 'primary', alpha: 1 },
      [0, 0, 0],
      place({ diameter: 300 }),
    );
    expect(a.s1[5]).toBeCloseTo(300);
    expect(a.sq[5]).toBeCloseTo(0.5);
  });
  it('plays a whole resolved cast + hit, then everything ends', () => {
    const pl = new VfxPlayer(makePool());
    const s = skills.find((x) => x.id === 'thien_hoa_luu_tinh')!;
    const v = resolveVfx(s.path, classElement(s.path), s);
    pl.cast(v, place());
    pl.hit(v, place({ x: 50 }), 0.2);
    expect(pl.count).toBeGreaterThan(3);
    for (let n = 0; n < 100; n++) pl.step(0.05);
    expect(pl.count).toBe(0);
  });
  it('the same casts always look the same (seeded jitter) and the trail travel time is bounded', () => {
    const run = () => {
      const pl = new VfxPlayer(makePool(), new VfxRng(7));
      const s = skills.find((x) => x.id === 'kinh_loi_thich')!;
      pl.cast(resolveVfx(s.path, classElement(s.path), s), place());
      return Array.from(pl.pool.x.slice(0, 20));
    };
    expect(run()).toEqual(run());
    expect(trailTravelS(0)).toBeGreaterThan(0);
    expect(trailTravelS(1e6)).toBeLessThanOrEqual(0.32);
  });
  it('every registered particle can be indexed', () => {
    expect(PARTICLE_NAMES.length).toBeLessThanOrEqual(255);
  });
});

describe('PART 3 VFX stills', () => {
  it('every class resolves its trail / burst / ring to its own stills, untinted, and the aura stays generic', () => {
    for (const c of skillDefinitions.classes) {
      const own = (list: Array<{ tex: string }>) => list.some((d) => d.tex.startsWith(`vfx_${c.path}_`));
      const probe = (id: string, shape: string, effects: string[], extra: Partial<SkillLike> = {}) =>
        resolveVfx(c.path, c.element, {
          id: `${id}_${c.path}`,
          element: 'root_main',
          shape: { type: shape, radius: 2 },
          targeting: { mode: 'enemy', range_tiles: 6 },
          effects: effects.map((type) => ({ type })),
          ...extra,
        });
      const trail = probe('t', 'line', ['damage']);
      expect(trail.archetype).toBe('trail');
      expect(trail.cast.find((d) => d.tex === `vfx_${c.path}_proj`)).toMatchObject({
        travel: true,
        face: true,
        tint: 'white',
      });
      expect(own(probe('b', 'cone', ['damage']).cast)).toBe(true);
      expect(own(probe('r', 'circle', ['damage']).cast)).toBe(true);
      expect(own(probe('a', 'single', ['heal']).cast)).toBe(false);
      expect(own(trail.hit)).toBe(true); // the small impact burst on the target is the class' burst still
    }
  });
  it('a travelling projectile takes the trail travel time (the hit burst lands with it) and ends at the target', () => {
    const pl = new VfxPlayer(makePool());
    const v = resolveVfx('phap', 'hoa', {
      id: 'x_proj',
      element: 'hoa',
      shape: { type: 'line' },
      targeting: { mode: 'enemy', range_tiles: 6 },
      effects: [{ type: 'damage' }],
    });
    pl.cast(v, place({ x: 0, y: 0, tx: 420, ty: -60, dx: 0.99, dy: -0.14 }));
    const p = pl.pool;
    let slot = -1;
    for (let i = 0; i < p.capacity; i++)
      if (p.used[i] && p.vx[i]! > 100 && p.life[i]! > 0.1 && p.life[i]! <= 0.32) slot = i;
    expect(slot).toBeGreaterThanOrEqual(0);
    const life = p.life[slot]!;
    expect(life).toBeCloseTo(trailTravelS(Math.hypot(420, 60)), 5);
    expect(p.vx[slot]! * life).toBeCloseTo(420, 3);
    expect(p.vy[slot]! * life).toBeCloseTo(-60, 3);
    expect(p.rot[slot]!).toBeCloseTo((Math.atan2(-0.14, 0.99) * 180) / Math.PI, 3);
  });
});
