/**
 * Honest clients must not trip the cooldown / GCD guard (D106). The server judges a cast at the guards' clock of the tick that PROCESSES it,
 * so any delay between a cast ARRIVING and its tick (50 ms tick quantization, and above all a stalled tick) used to shift the cooldown start:
 * a client that waits cooldown + margin (measured on its own clock between its two sends) could still be rejected. The node now measures
 * how long each cast sat in the inbox (`CastInput.ageMs`) and judges and stamps it as of its arrival.
 */
import { describe, expect, it } from 'vitest';
import { decode, encode, type Message } from '@vgtd/protocol';
import { CastReason, compileSkills } from '@vgtd/sim';
import { WorldNode, type ClientTransport } from '../src/index.js';

class Client implements ClientTransport {
  msgs: Message[] = [];
  send(data: Uint8Array): void {
    try {
      this.msgs.push(decode(data));
    } catch {
      /* delta snapshots need a baseline: not needed here */
    }
  }
  close(): void {}
  buffered(): number {
    return 0;
  }
  results(): Array<Extract<Message, { type: 'skill_result' }>> {
    return this.msgs.filter((m): m is Extract<Message, { type: 'skill_result' }> => m.type === 'skill_result');
  }
}

const SKILL = compileSkills().find((s) => s.key === 'kiem_khi_tram')!;

interface Opts {
  /** wall ms the server is stalled right after cast A arrives (A is processed when it ends) */
  stallMs: number;
  /** extra wall ms the client waits beyond the skill cooldown (the bot's margin) */
  marginMs: number;
  /** wall ms into a tick period at which A arrives (0..49) */
  phaseMs?: number;
}

/** A sends a cast, the server stalls, the client waits `cooldown + margin` of WALL time after its send and casts again. Returns B's answer. */
function honestRecast(o: Opts): { a: CastReason | undefined; b: CastReason | undefined } {
  const wall = { ms: 0 };
  const node = new WorldNode({
    seed: 3,
    mapTiles: 64,
    spawn: { i0: 20, j0: 20, side: 1 },
    combat: {},
    wallClock: () => wall.ms,
    packetClock: () => wall.ms,
  });
  const c = new Client();
  const id = node.addPlayer(c, 'acc');
  const tickOnce = (): void => {
    wall.ms += 50;
    node.tick();
  };
  for (let k = 0; k < 20; k++) tickOnce();
  wall.ms += o.phaseMs ?? 0;
  const sentA = wall.ms;
  node.receive(id, encode({ type: 'skill_cast', seq: 1, skillId: SKILL.id, targetId: 0, aim: null }));
  wall.ms += o.stallMs; // the server is busy: A waits in the inbox
  node.tick();
  const sentB = sentA + SKILL.cooldownMs + o.marginMs;
  let sent = false;
  for (let guard = 0; guard < 400 && !sent; guard++) {
    if (wall.ms + 50 >= sentB) {
      wall.ms = sentB; // B arrives on time
      node.receive(id, encode({ type: 'skill_cast', seq: 2, skillId: SKILL.id, targetId: 0, aim: null }));
      sent = true;
    }
    if (!sent) tickOnce();
  }
  for (let k = 0; k < 30; k++) tickOnce(); // a resolved cast answers when its cast time is over
  const r = c.results();
  return { a: r.find((m) => m.seq === 1)?.reason, b: r.find((m) => m.seq === 2)?.reason };
}

describe('honest recast after the cooldown (D106)', () => {
  it('is accepted with no stall, whatever the tick phase', () => {
    for (const phaseMs of [0, 10, 25, 49]) {
      const r = honestRecast({ stallMs: 0, marginMs: 150, phaseMs });
      expect(r, `phase ${phaseMs}`).toEqual({ a: CastReason.Ok, b: CastReason.Ok });
    }
  });

  it('is accepted when the server stalled for 100-500 ms right after the first cast arrived (it used to be rejected as a cooldown violation)', () => {
    for (const stallMs of [100, 200, 350, 500]) {
      const r = honestRecast({ stallMs, marginMs: 150 });
      expect(r, `stall ${stallMs} ms`).toEqual({ a: CastReason.Ok, b: CastReason.Ok });
    }
  });

  it('still rejects a client that really recasts early (arrival time counts, not the stall)', () => {
    const r = honestRecast({ stallMs: 300, marginMs: -200 });
    expect(r.b).toBe(CastReason.Cooldown);
  });
});
