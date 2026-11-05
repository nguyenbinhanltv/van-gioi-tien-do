import { describe, expect, it } from 'vitest';
import { FLAG_DODGE, FLAG_FLY_TOGGLE, FLAG_QINGGONG, InputManager, emptyFrame, encodeDir } from '@vgtd/client-core';
import {
  MAG_MAX,
  FLAG_DODGE as SIM_DODGE,
  FLAG_FLY_TOGGLE as SIM_FLY,
  FLAG_QINGGONG as SIM_QG,
  encodeDirection,
} from '@vgtd/sim';
import { createWorld, spawnEntity, step, TileGrid } from '@vgtd/sim';
import { decode, encode, inputPacketFrom, type InputMsg } from '@vgtd/protocol';

describe('client-core InputManager packing ⇄ sim/protocol', () => {
  it('flag bits and magnitude range agree', () => {
    expect([FLAG_DODGE, FLAG_FLY_TOGGLE, FLAG_QINGGONG]).toEqual([SIM_DODGE, SIM_FLY, SIM_QG]);
    expect(MAG_MAX).toBe(15);
  });

  it('direction quantisation is identical (256 levels, 255 = idle)', () => {
    for (let k = 0; k < 720; k++) {
      const a = (k / 720) * Math.PI * 2;
      expect(encodeDirection(Math.cos(a), Math.sin(a))).toBe(encodeDir(Math.cos(a), Math.sin(a)));
    }
    expect(encodeDirection(0, 0)).toBe(255);
    expect(encodeDir(0, 0)).toBe(255);
  });

  it('InputFrame → toPacket → wire → decode → sim input moves the character the way the player pushed', () => {
    const grid = TileGrid.fromRows(Array.from({ length: 64 }, () => '.'.repeat(64)));
    const cases = [
      { move: { i: 1, j: 0 }, magnitude: 1, dodge: false },
      { move: { i: 0.6, j: 0.8 }, magnitude: 1, dodge: false },
      { move: { i: -0.7071, j: 0.7071 }, magnitude: 0.5, dodge: false },
      { move: { i: 0, j: -1 }, magnitude: 1, dodge: true },
    ];
    for (const c of cases) {
      const f = { ...emptyFrame(), ...c };
      const pkt = inputPacketFrom(InputManager.toPacket(f), 7, 50);
      const msg = decode(encode({ type: 'input', ack: 0, inputs: [pkt] })) as InputMsg;
      const got = msg.inputs[0]!;
      expect(got).toEqual(pkt);
      let w = spawnEntity(createWorld(1), { id: 1, i: 32.5, j: 32.5 });
      w = step(w, [{ kind: 'move', entityId: 1, ...got }], { grid, skills: [] }).world;
      const e = w.entities[0]!;
      const di = e.i - 32.5;
      const dj = e.j - 32.5;
      const len = Math.hypot(di, dj);
      expect(len).toBeGreaterThan(0);
      // heading within one quantisation step (360/256 ≈ 1.4°) of the requested direction
      const want = Math.atan2(c.move.j, c.move.i);
      let diff = Math.abs(Math.atan2(dj, di) - want);
      diff = Math.min(diff, Math.PI * 2 - diff);
      expect(diff).toBeLessThan((Math.PI * 2) / 256);
      expect(e.lastSeq).toBe(7);
      if (c.dodge) expect(e.invulnMs).toBeGreaterThan(0);
    }
  });

  it('idle packet (dir 255, mag 0) leaves the character in place', () => {
    const pkt = inputPacketFrom(InputManager.toPacket(emptyFrame()), 1, 50);
    expect(pkt.dir).toBe(255);
    expect(pkt.mag).toBe(0);
  });
});
