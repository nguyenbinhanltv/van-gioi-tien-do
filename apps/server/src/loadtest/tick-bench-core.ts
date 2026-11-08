/**
 * In-process World Node tick benchmark core: no sockets, no worker threads, fully deterministic inputs (a virtual clock drives the
 * per-client packet-rate window, so the result does not depend on how fast the server is). `tick-bench.ts` is the CLI; the golden
 * test (tests/snapshot-golden.test.ts) imports `runTickBench` to prove an optimisation did not change a single byte sent.
 */
import { ZONE_SPAWN_TABLES, skillsOf } from '@vgtd/shared';
import { encode } from '@vgtd/protocol';
import { compileSkills } from '@vgtd/sim';
import { WorldNode, type ClientTransport } from '../world/node.js';
import { dist } from './stats.js';

export interface TickBenchOptions {
  players: number;
  /** measured ticks (after `warm`) */
  ticks: number;
  warm: number;
  /** side of the square the players spawn in and the mobs fill, in tiles */
  area: number;
  mobs: number;
  /** server combat on (default true). Off = a world of pure movement + AOI + encode: the stable basis for golden checks. */
  combat?: boolean;
  /** mobs in chase attack their target (D86, default true). The pre-D86 golden streams pin it false. */
  mobAttacks?: boolean;
  /** fold every byte sent into `checksum` (slow: for equivalence checks, not for timing) */
  hash: boolean;
}

const MAP = 256;

/** tiny deterministic LCG: behaviour of the fake players only (never simulation state) */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

class Sink implements ClientTransport {
  bytes = 0;
  frames = 0;
  hash = 0x811c9dc5;
  constructor(private readonly doHash: boolean) {}
  send(data: Uint8Array): void {
    this.bytes += data.length;
    this.frames++;
    if (this.doHash) {
      let h = this.hash;
      for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i]!, 0x01000193) >>> 0;
      this.hash = h;
    }
  }
  close(): void {}
  buffered(): number {
    return 0;
  }
}

export interface TickBenchResult {
  cpuMsPerTick: number;
  wall: ReturnType<typeof dist>;
  phases: { stepMean: number; aoiMean: number; snapMean: number };
  bytesPerPlayerPerS: number;
  totalBytes: number;
  frames: number;
  /** FNV-1a over every byte of every message sent to every client, from the first tick; null unless `hash` */
  checksum: string | null;
}

export function runTickBench(o: TickBenchOptions): TickBenchResult {
  const skills = compileSkills();
  const owned = new Set(skillsOf('kiem').map((k) => k.id));
  const skillIds = skills.filter((k) => owned.has(k.key)).map((k) => k.id);
  const per = ZONE_SPAWN_TABLES.find((t) => t.zone === 'bia_rung')!.groups.reduce((n, g) => n + g.count, 0);
  const lo = MAP / 2 - o.area / 2;
  let virtualMs = 0; // the packet-rate window runs on simulated time: the benchmark must not depend on how fast the server is
  const node = new WorldNode({
    packetClock: () => virtualMs,
    seed: 1,
    mapTiles: MAP,
    spawn: { i0: lo, j0: lo, side: o.area },
    skills,
    combat: o.combat === false ? undefined : { mobAttacks: o.mobAttacks },
    mobs:
      o.mobs > 0
        ? { zones: [{ zone: 'bia_rung', i0: lo, j0: lo, i1: lo + o.area, j1: lo + o.area }], density: o.mobs / per }
        : undefined,
  });
  const sinks: Sink[] = [];
  const ids: number[] = [];
  const rnd: (() => number)[] = [];
  const seqs: number[] = [];
  for (let k = 0; k < o.players; k++) {
    const s = new Sink(o.hash);
    sinks.push(s);
    ids.push(node.addPlayer(s, `bench${k}`));
    rnd.push(lcg(1000 + k));
    seqs.push(0);
  }
  const dirs = new Array<number>(o.players).fill(0);
  const step = (t: number): void => {
    virtualMs = t * 50;
    for (let k = 0; k < o.players; k++) {
      if (t % 40 === (k * 7) % 40) dirs[k] = rnd[k]!() < 0.15 ? 255 : Math.floor(rnd[k]!() * 255);
      const seq = ++seqs[k]! & 0xffff;
      node.receive(
        ids[k]!,
        encode({
          type: 'input',
          ack: 0,
          inputs: [{ seq, dtMs: 50, dir: dirs[k]!, mag: dirs[k] === 255 ? 0 : 15, flags: 0 }],
        }),
      );
      // one cast per player about every 900 ms, spread over the o.ticks
      if (skillIds.length && t % 18 === k % 18) {
        node.receive(
          ids[k]!,
          encode({
            type: 'skill_cast',
            seq,
            skillId: skillIds[Math.floor(rnd[k]!() * skillIds.length)]!,
            targetId: 0,
            aim: null,
          }),
        );
      }
    }
  };
  for (let t = 0; t < o.warm; t++) {
    step(t);
    node.tick();
  }
  node.tickMs.length = 0;
  Object.assign(node.phases, { stepMs: 0, aoiMs: 0, snapMs: 0, aoiTicks: 0, maxStepMs: 0, maxAoiMs: 0, maxSnapMs: 0 });
  const bytes0 = sinks.reduce((a, s) => a + s.bytes, 0);
  const frames0 = sinks.reduce((a, s) => a + s.frames, 0);
  const cpu0 = process.cpuUsage();
  for (let t = 0; t < o.ticks; t++) {
    step(o.warm + t);
    node.tick();
  }
  const cpu = process.cpuUsage(cpu0);
  const total = sinks.reduce((a, s) => a + s.bytes, 0) - bytes0;
  const wall = dist(node.tickMs);
  const aoiTicks = Math.max(1, node.phases.aoiTicks);
  let checksum: string | null = null;
  if (o.hash) {
    let h = 0x811c9dc5;
    for (const s of sinks) h = Math.imul(h ^ s.hash, 0x01000193) >>> 0;
    checksum = h.toString(16).padStart(8, '0');
  }
  return {
    cpuMsPerTick: (cpu.user + cpu.system) / 1000 / o.ticks,
    wall,
    phases: {
      stepMean: node.phases.stepMs / o.ticks,
      aoiMean: node.phases.aoiMs / aoiTicks,
      snapMean: node.phases.snapMs / o.ticks,
    },
    bytesPerPlayerPerS: total / o.players / (o.ticks * 0.05),
    totalBytes: total,
    frames: sinks.reduce((a, s) => a + s.frames, 0) - frames0,
    checksum,
  };
}
