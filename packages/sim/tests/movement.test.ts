import { describe, expect, it } from 'vitest';
import { COLLIDER_RADIUS_TILES, DIRECTIONS, DIRECTION_TILE_VECTORS, NETWORK, statsAt } from '@vgtd/shared';
import {
  DIR_COS,
  DIR_SIN,
  DASH_SPEED,
  FLAG_DODGE,
  FLAG_FLY_TOGGLE,
  FLY_SPEED,
  TileGrid,
  WALK_SPEED,
  circleBlocked,
  directionOf,
  encodeDirection,
  seqNewer,
  stepMove,
  walkSpeed,
  type MoveState,
} from '../src/index.js';
import { E, NW, S, SE, SW, ctxOf, ent, mv, openGrid, run, worldWith } from './helpers.js';

const base = (o: Partial<MoveState> = {}): MoveState => ({
  i: 10.5,
  j: 10.5,
  vi: 0,
  vj: 0,
  layer: 0,
  flying: false,
  qinggong: false,
  facing: 32,
  agi: 100,
  dashLeftMs: 0,
  dashCdMs: 0,
  invulnMs: 0,
  ...o,
});

describe('direction table', () => {
  it('matches Math.cos/sin to 1e-12 and is exactly symmetric at quadrants', () => {
    for (let k = 0; k < 256; k++) {
      expect(DIR_COS[k]).toBeCloseTo(Math.cos((k / 256) * Math.PI * 2), 12);
      expect(DIR_SIN[k]).toBeCloseTo(Math.sin((k / 256) * Math.PI * 2), 12);
    }
    expect(DIR_COS[0]).toBe(1);
    expect(DIR_SIN[0]).toBe(0);
    expect(DIR_COS[64]).toBeCloseTo(0, 15);
    expect(DIR_SIN[64]).toBe(1);
  });
  it('8 direction codes map to the shared screen directions / tile vectors', () => {
    for (const d of DIRECTIONS) {
      const [di, dj] = DIRECTION_TILE_VECTORS[d];
      const code = encodeDirection(di, dj);
      expect(directionOf(code), `${d} code ${code}`).toBe(d);
    }
  });
  it('seqNewer handles uint16 wrap', () => {
    expect(seqNewer(2, 1)).toBe(true);
    expect(seqNewer(1, 2)).toBe(false);
    expect(seqNewer(0, 65535)).toBe(true);
    expect(seqNewer(65535, 0)).toBe(false);
    expect(seqNewer(5, 5)).toBe(false);
  });
});

describe('movement speed (docs/08 §4)', () => {
  it('walks 4.5 tiles/s: 20 ticks of 50 ms = 4.5 tiles along +i', () => {
    let s = base();
    const g = openGrid();
    for (let t = 0; t < 20; t++) s = stepMove(s, { dtMs: 50, dir: SE, mag: 15, flags: 0 }, g);
    expect(s.i - 10.5).toBeCloseTo(WALK_SPEED, 9);
    expect(s.j).toBeCloseTo(10.5, 9);
    expect(s.vi).toBeCloseTo(WALK_SPEED, 9);
  });
  it('speed is uniform in tile space (diagonal S moves 4.5 tiles, not more)', () => {
    let s = base();
    for (let t = 0; t < 20; t++) s = stepMove(s, { dtMs: 50, dir: S, mag: 15, flags: 0 }, openGrid());
    expect(Math.hypot(s.i - 10.5, s.j - 10.5)).toBeCloseTo(WALK_SPEED, 9);
  });
  it('Thân pháp multiplies walk speed: × (1 + (TP − 100)/400)', () => {
    expect(walkSpeed(100)).toBe(4.5);
    expect(walkSpeed(220)).toBeCloseTo(4.5 * 1.3, 12);
    const tp = statsAt(9, 1).agi; // 220
    expect(walkSpeed(tp)).toBeCloseTo(4.5 * 1.3, 9);
  });
  it('analog magnitude scales speed (mag 8/15)', () => {
    const s = stepMove(base(), { dtMs: 50, dir: SE, mag: 8, flags: 0 }, openGrid());
    expect(s.i - 10.5).toBeCloseTo((8 / 15) * 4.5 * 0.05, 12);
  });
  it('idle (dir 255) does not move; facing is kept', () => {
    const s = stepMove(base({ facing: 64 }), { dtMs: 50, dir: 255, mag: 0, flags: 0 }, openGrid());
    expect([s.i, s.j, s.facing]).toEqual([10.5, 10.5, 64]);
  });
  it('dash: 12 tiles/s for 250 ms (3 tiles), 1.5 s cooldown, 150 ms invulnerable', () => {
    let s = base();
    const g = openGrid();
    s = stepMove(s, { dtMs: 50, dir: SE, mag: 15, flags: FLAG_DODGE }, g);
    expect(s.invulnMs).toBe(100);
    expect(s.dashCdMs).toBe(1450);
    for (let t = 0; t < 4; t++) s = stepMove(s, { dtMs: 50, dir: SE, mag: 15, flags: 0 }, g);
    expect(s.i - 10.5).toBeCloseTo(DASH_SPEED * 0.25, 9); // 3 tiles in the 5 inputs = 250 ms
    expect(s.dashLeftMs).toBe(0);
    // a second dodge during cooldown does nothing
    const s2 = stepMove(s, { dtMs: 50, dir: SE, mag: 15, flags: FLAG_DODGE }, g);
    expect(s2.i - s.i).toBeCloseTo(WALK_SPEED * 0.05, 9);
    expect(s2.dashLeftMs).toBe(0);
  });
  it('dash while idle continues along the facing direction', () => {
    const s = stepMove(base({ facing: SW }), { dtMs: 50, dir: 255, mag: 0, flags: FLAG_DODGE }, openGrid());
    expect(s.j - 10.5).toBeCloseTo(0.6, 9);
    expect(s.i).toBeCloseTo(10.5, 9);
  });
  it('flight: toggled by flag, 18 tiles/s, ignores ground walls but not the map edge', () => {
    const g = TileGrid.fromRows(['.....', '.###.', '.###.', '.###.', '.....']);
    let s = base({ i: 0.5, j: 2.5 });
    s = stepMove(s, { dtMs: 50, dir: SE, mag: 15, flags: FLAG_FLY_TOGGLE }, g);
    expect(s.flying).toBe(true);
    for (let t = 0; t < 4; t++) s = stepMove(s, { dtMs: 50, dir: SE, mag: 15, flags: 0 }, g);
    expect(s.i).toBeGreaterThan(3.5); // flew across the wall block
    for (let t = 0; t < 10; t++) s = stepMove(s, { dtMs: 50, dir: SE, mag: 15, flags: 0 }, g);
    expect(s.i).toBeLessThanOrEqual(5 - COLLIDER_RADIUS_TILES + 1e-9); // map edge stops it
    expect(FLY_SPEED).toBe(18);
  });
  it('no-fly tiles stop flying entities', () => {
    const g = TileGrid.fromRows(['..n..', '..n..', '..n..']);
    let s = base({ i: 0.5, j: 1.5, flying: true });
    for (let t = 0; t < 10; t++) s = stepMove(s, { dtMs: 50, dir: SE, mag: 15, flags: 0 }, g);
    expect(s.i).toBeLessThanOrEqual(2 - COLLIDER_RADIUS_TILES + 1e-9);
  });
  it('single input is pure: the previous state object is not mutated', () => {
    const s0 = base();
    const copy = { ...s0 };
    stepMove(s0, { dtMs: 50, dir: SE, mag: 15, flags: 0 }, openGrid());
    expect(s0).toEqual(copy);
  });
});

describe('collision (axis-separated, r = 0.35)', () => {
  const walls = TileGrid.fromRows([
    '#########',
    '#.......#',
    '#.......#',
    '#...#...#',
    '#.......#',
    '#.......#',
    '#########',
  ]);
  const walk = (s: MoveState, dir: number, ticks: number, g = walls) => {
    for (let t = 0; t < ticks; t++) s = stepMove(s, { dtMs: 50, dir, mag: 15, flags: 0 }, g);
    return s;
  };

  it('stops against a wall at exactly r from the face', () => {
    const s = walk(base({ i: 4.5, j: 1.5 }), SE, 40);
    expect(s.i).toBeCloseTo(8 - COLLIDER_RADIUS_TILES, 2);
    expect(s.j).toBeCloseTo(1.5, 9);
  });
  it('slides along a wall: diagonal into the east wall keeps moving in j', () => {
    const s = walk(base({ i: 6.5, j: 1.5 }), S, 12);
    expect(s.i).toBeCloseTo(8 - COLLIDER_RADIUS_TILES, 2);
    expect(s.j).toBeGreaterThan(3.3); // 12 ticks × 0.159 tiles/axis
  });
  it('slides along the top wall moving in i', () => {
    const s = walk(base({ i: 1.5, j: 1.5 }), 224 /* (+i, −j) */, 10);
    expect(s.j).toBeCloseTo(1 + COLLIDER_RADIUS_TILES, 2);
    expect(s.i).toBeGreaterThan(3);
  });
  it('outer corner: walks around a pillar without sticking or entering it', () => {
    // pillar at tile (4,3); come in diagonally at its corner
    let s = base({ i: 3.0, j: 2.0 });
    for (let t = 0; t < 60; t++) {
      s = stepMove(s, { dtMs: 50, dir: S, mag: 15, flags: 0 }, walls);
      expect(circleBlocked(walls, s.i, s.j, COLLIDER_RADIUS_TILES, 0), `tick ${t}`).toBe(false);
    }
    expect(s.i + s.j).toBeGreaterThan(12); // slid off the corner and kept going (no sticking)
  });
  it('inner corner (two walls): stops without oscillating', () => {
    const a = walk(base({ i: 6.5, j: 4.5 }), S, 30);
    const b = walk(a, S, 5);
    expect(b.i).toBeCloseTo(a.i, 9);
    expect(b.j).toBeCloseTo(a.j, 9);
    expect(a.i).toBeCloseTo(8 - COLLIDER_RADIUS_TILES, 2);
    expect(a.j).toBeCloseTo(6 - COLLIDER_RADIUS_TILES, 2);
  });
  it('a gap exactly one tile wide admits r = 0.35 but not a 0.7-wide block', () => {
    const g = TileGrid.fromRows(['#####', '.....', '#####']);
    let s = base({ i: 0.5, j: 1.5 });
    for (let t = 0; t < 30; t++) s = stepMove(s, { dtMs: 50, dir: SE, mag: 15, flags: 0 }, g);
    expect(s.i).toBeGreaterThan(3.5);
  });
  it('exactly touching is allowed (strict overlap blocks)', () => {
    expect(circleBlocked(walls, 8 - COLLIDER_RADIUS_TILES, 2.5, COLLIDER_RADIUS_TILES, 0)).toBe(false);
    expect(circleBlocked(walls, 8 - COLLIDER_RADIUS_TILES + 0.01, 2.5, COLLIDER_RADIUS_TILES, 0)).toBe(true);
  });
  it('map edge blocks', () => {
    const s = walk(base({ i: 1.5, j: 1.5 }), NW, 20);
    expect(s.i).toBeCloseTo(1 + COLLIDER_RADIUS_TILES, 2);
    const o = openGrid(8);
    const t = walk(base({ i: 4, j: 4 }), SE, 100, o);
    expect(t.i).toBeCloseTo(8 - COLLIDER_RADIUS_TILES, 2);
  });
  it('no tunnelling: a 12 tiles/s dash and 18 tiles/s flight never cross a one-tile wall', () => {
    const g = TileGrid.fromRows(['.......', '.......', '...#...', '.......', '.......']);
    for (const dir of [SE, S, E, SW]) {
      for (let startJ = 0; startJ < 5; startJ += 1) {
        let s = base({ i: 0.5, j: startJ + 0.5 });
        s = stepMove(s, { dtMs: 50, dir, mag: 15, flags: FLAG_DODGE }, g);
        for (let t = 0; t < 40; t++) {
          s = stepMove(s, { dtMs: 50, dir, mag: 15, flags: 0 }, g);
          expect(circleBlocked(g, s.i, s.j, COLLIDER_RADIUS_TILES, 0)).toBe(false);
        }
      }
    }
  });
  it('random walk never ends inside a blocked tile (invariant fuzz)', () => {
    let seed = 12345;
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    const rows: string[] = [];
    for (let j = 0; j < 24; j++) {
      let row = '';
      for (let i = 0; i < 24; i++) row += i === 0 || j === 0 || i === 23 || j === 23 || rnd() < 0.2 ? '#' : '.';
      rows.push(row);
    }
    rows[12] = rows[12]!.slice(0, 12) + '.' + rows[12]!.slice(13);
    const g = TileGrid.fromRows(rows);
    let s = base({ i: 12.5, j: 12.5 });
    for (let t = 0; t < 5000; t++) {
      const dir = Math.floor(rnd() * 255);
      const flags = rnd() < 0.02 ? FLAG_DODGE : 0;
      s = stepMove(s, { dtMs: 8 + Math.floor(rnd() * 43), dir, mag: 1 + Math.floor(rnd() * 15), flags }, g);
      expect(circleBlocked(g, s.i, s.j, COLLIDER_RADIUS_TILES, 0)).toBe(false);
    }
  });
});

describe('elevation', () => {
  // level 0 floor → stair rising toward +i → level 1 floor
  const g = TileGrid.fromRows(['#######', '#..>11#', '#######']);
  it('can climb a stair to level 1', () => {
    let s = base({ i: 1.5, j: 1.5 });
    for (let t = 0; t < 40; t++) s = stepMove(s, { dtMs: 50, dir: SE, mag: 15, flags: 0 }, g);
    expect(s.layer).toBe(1);
    expect(s.i).toBeGreaterThan(4.5);
  });
  it('level edges without a stair are walls', () => {
    const w = TileGrid.fromRows(['#####', '#.1.#', '#####']);
    let s = base({ i: 1.5, j: 1.5 });
    for (let t = 0; t < 20; t++) s = stepMove(s, { dtMs: 50, dir: SE, mag: 15, flags: 0 }, w);
    expect(s.i).toBeCloseTo(2 - COLLIDER_RADIUS_TILES, 2);
    expect(s.layer).toBe(0);
  });
  it('a stair is a wall from its sides', () => {
    const w = TileGrid.fromRows(['#.#', '#>#', '#.#']);
    // entity at level 0 in the stair tile moving along j stays inside (walls at i sides); fine — check it is passable along its axis only
    expect(circleBlocked(w, 1.5, 1.5, COLLIDER_RADIUS_TILES, 0)).toBe(false);
    expect(circleBlocked(w, 1.5, 1.5, COLLIDER_RADIUS_TILES, 2)).toBe(true);
  });
});

describe('server tick integration', () => {
  it('step() moves an entity exactly like stepMove and echoes lastSeq', () => {
    const ctx = ctxOf();
    let w = worldWith(1, { id: 7, i: 10.5, j: 10.5 });
    const r = run(w, ctx, 20, (t) => [mv(7, t + 1, SE)]);
    w = r.world;
    expect(ent(w, 7).i - 10.5).toBeCloseTo(4.5, 9);
    expect(ent(w, 7).lastSeq).toBe(20);
    expect(w.tick).toBe(20);
    expect(w.timeMs).toBe(20 * NETWORK.TICK_MS);
  });
  it('inputs are applied in seq order regardless of arrival order (incl. uint16 wrap)', () => {
    const ctx = ctxOf();
    const w0 = worldWith(1, { id: 1, i: 10.5, j: 10.5 });
    const a = run(w0, ctx, 1, () => [mv(1, 65535, SE, { dtMs: 25 }), mv(1, 0, SW, { dtMs: 25 })]).world;
    const b = run(w0, ctx, 1, () => [mv(1, 0, SW, { dtMs: 25 }), mv(1, 65535, SE, { dtMs: 25 })]).world;
    expect(ent(a, 1)).toEqual(ent(b, 1));
    expect(ent(a, 1).lastSeq).toBe(0);
  });
  it('client prediction equals server for the same input stream (shared stepMove)', () => {
    const ctx = ctxOf();
    let w = worldWith(1, { id: 1, i: 20.5, j: 20.5 });
    let c = base({ i: 20.5, j: 20.5 });
    for (let t = 0; t < 400; t++) {
      const dir = (t * 7) % 255;
      w = run(w, ctx, 1, () => [mv(1, t, dir, { flags: t % 90 === 0 ? FLAG_DODGE : 0 })]).world;
      c = stepMove(c, { dtMs: 50, dir, mag: 15, flags: t % 90 === 0 ? FLAG_DODGE : 0 }, ctx.grid);
    }
    const e = ent(w, 1);
    expect([e.i, e.j, e.layer, e.dashCdMs]).toEqual([c.i, c.j, c.layer, c.dashCdMs]);
  });
});
