import type { EntityState, SimWorld } from './types.js';

/** Canonical state hash (two independent FNV-1a 32-bit lanes → 16 hex chars). Covers every gameplay field, in fixed order. */
export function stateHash(world: SimWorld): string {
  const buf = new DataView(new ArrayBuffer(8));
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0xdeadbeef;
  const byte = (b: number) => {
    h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (b + 0x9e), 0x85ebca6b) >>> 0;
  };
  const num = (x: number) => {
    buf.setFloat64(0, x, true);
    for (let k = 0; k < 8; k++) byte(buf.getUint8(k));
  };
  const bool = (b: boolean) => byte(b ? 1 : 0);

  num(world.tick);
  num(world.timeMs);
  num(world.rng);
  num(world.entities.length);
  for (const e of world.entities) hashEntity(e, num, bool);
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function hashEntity(e: EntityState, num: (x: number) => void, bool: (b: boolean) => void): void {
  num(e.id);
  num(e.i);
  num(e.j);
  num(e.vi);
  num(e.vj);
  num(e.layer);
  bool(e.flying);
  bool(e.qinggong);
  num(e.facing);
  num(e.agi);
  num(e.dashLeftMs);
  num(e.dashCdMs);
  num(e.invulnMs);
  num(e.hp);
  num(e.mp);
  num(e.stunMs);
  num(e.lastSeq);
  num(e.gcdReadyAt);
  bool(e.connected);
  num(e.cooldowns.length);
  for (const c of e.cooldowns) num(c);
  num(e.pending.length);
  for (const p of e.pending) {
    num(p.seq);
    num(p.dtMs);
    num(p.dir);
    num(p.mag);
    num(p.flags);
  }
  const a = e.ac;
  num(a.t0Ms);
  num(a.claimedMs);
  num(a.lastSlideMs);
  num(a.windowStartMs);
  num(a.windowClaimedMs);
  num(a.hotWindows);
  num(a.score);
  bool(a.warned);
  num(a.castTokens);
  num(a.castRefillMs);
}
