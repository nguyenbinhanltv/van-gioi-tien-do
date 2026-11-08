import { describe, it, expect } from 'vitest';
import { MOB_DEFS } from '@vgtd/shared';
import manifest from '../../../tools/procgen/src/gemini/manifest.json';
import { BOB_PX, DEATH_FADE_S, HIT_FLASH_S, mobDefIdOfName, newMotion, stepMotion } from '../assets/scripts/MobMotion';

const alive = (i: number, j: number, hp = 100) => ({ pos: { i, j }, hp, alive: true });

describe('mobDefIdOfName', () => {
  it('reads the wire id out of the server mob name and ignores everything else', () => {
    expect(mobDefIdOfName('Mob 12')).toBe(12);
    expect(mobDefIdOfName('Moc nhan 2')).toBeNull();
    expect(mobDefIdOfName('Mob x')).toBeNull();
    expect(mobDefIdOfName('Mob 3 (hits back)')).toBeNull();
  });
});

describe('stepMotion', () => {
  it('faces left by default, mirrors when it moves right on screen, keeps facing when it stops', () => {
    const s = newMotion(1);
    expect(stepMotion(s, 0.016, alive(10, 10)).scaleX).toBe(1);
    // +i = screen right-down
    expect(stepMotion(s, 0.016, alive(10.2, 10)).scaleX).toBe(-1);
    expect(stepMotion(s, 0.016, alive(10.2, 10)).scaleX).toBe(-1); // standing still: keeps facing
    // +j = screen left-down
    expect(stepMotion(s, 0.016, alive(10.2, 10.3)).scaleX).toBe(1);
  });

  it('bobs a little around the foot and never leaves the amplitude', () => {
    const s = newMotion(3);
    let min = 0,
      max = 0;
    for (let k = 0; k < 400; k++) {
      const o = stepMotion(s, 1 / 60, alive(5, 5));
      min = Math.min(min, o.bobY);
      max = Math.max(max, o.bobY);
    }
    expect(max).toBeLessThanOrEqual(BOB_PX + 1e-9);
    expect(min).toBeGreaterThanOrEqual(-BOB_PX - 1e-9);
    expect(max - min).toBeGreaterThan(BOB_PX); // it really moves
  });

  it('flashes on an hp drop for HIT_FLASH_S, not on a heal or at the first sight', () => {
    const s = newMotion(2);
    expect(stepMotion(s, 0.016, alive(5, 5, 80)).flashing).toBe(false); // first sight
    expect(stepMotion(s, 0.016, alive(5, 5, 60)).flashing).toBe(true); // hit
    let frames = 0;
    while (stepMotion(s, 0.016, alive(5, 5, 60)).flashing) frames++;
    expect(frames * 0.016).toBeLessThanOrEqual(HIT_FLASH_S);
    expect(stepMotion(s, 0.016, alive(5, 5, 90)).flashing).toBe(false); // heal
  });

  it('fades out over DEATH_FADE_S, then hides; a respawn brings it back clean', () => {
    const s = newMotion(4);
    stepMotion(s, 0.016, alive(5, 5, 50));
    const dead = { pos: { i: 5, j: 5 }, hp: 0, alive: false };
    const first = stepMotion(s, 0.1, dead);
    expect(first.visible).toBe(true);
    expect(first.alpha).toBeLessThan(255);
    expect(first.alpha).toBeGreaterThan(0);
    const last = stepMotion(s, DEATH_FADE_S, dead);
    expect(last.visible).toBe(false);
    expect(last.alpha).toBe(0);
    const back = stepMotion(s, 0.016, alive(5, 5, 100));
    expect(back.visible).toBe(true);
    expect(back.alpha).toBe(255);
    expect(back.flashing).toBe(false); // a respawn is not a hit
  });
});

describe('mob atlas manifest', () => {
  it('has one standee per MOB_DEFS entry with the wire id and the docs/03 section 6 canvas by footprint', () => {
    const keys = Object.keys(manifest.mobs).sort();
    expect(keys).toEqual(MOB_DEFS.map((d) => d.key).sort());
    for (const d of MOB_DEFS) {
      const m = (manifest.mobs as Record<string, { id: number; box: number }>)[d.key]!;
      expect(m.id, d.key).toBe(d.id);
      const box = d.tier === 'normal' ? 128 : d.tier === 'elite' ? 192 : d.footprint === 4 ? 512 : 256;
      expect(m.box, d.key).toBe(box);
    }
  });
});
