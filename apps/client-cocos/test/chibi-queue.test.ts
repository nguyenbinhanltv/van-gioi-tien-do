import { describe, it, expect } from 'vitest';
import { JobQueue } from '../assets/scripts/ChibiQueue';

/** A job whose completion the test controls. */
function controlled(order: string[], name: string) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return {
    release,
    run: async () => {
      order.push(`start ${name}`);
      await gate;
      return name;
    },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('JobQueue', () => {
  it('local player turn during an NPC queue: a promoted prefetch job jumps ahead of earlier NPC jobs', async () => {
    const q = new JobQueue();
    q.maxActive = 1;
    q.openBackground();
    const order: string[] = [];
    const jobs = ['npc1', 'npc2', 'npc3', 'prefetch-SE', 'npc4'].map((n) => controlled(order, n));
    const names = ['npc1', 'npc2', 'npc3', 'prefetch-SE', 'npc4'];
    names.forEach((n, i) => void q.enqueue(`rig ${n}`, 1, n, jobs[i]!.run));
    await tick();
    expect(order).toEqual(['start npc1']); // npc1 already running, the rest queued by seq
    // the player turns SE: the same key is requested at priority 0
    const p = q.enqueue('rig prefetch-SE', 0, 'prefetch-SE', jobs[3]!.run);
    expect(q.queued).toBe(4);
    jobs[0]!.release();
    await tick();
    expect(order).toEqual(['start npc1', 'start prefetch-SE']); // before npc2/npc3
    jobs[3]!.release();
    await expect(p).resolves.toBe('prefetch-SE');
    await tick();
    expect(order[2]).toBe('start npc2');
  });

  it('returns the same promise for a key and does not run it twice', async () => {
    const q = new JobQueue();
    q.openBackground();
    let runs = 0;
    const run = async () => (++runs, 'x');
    const a = q.enqueue('k', 1, 'k', run);
    const b = q.enqueue('k', 1, 'k', run);
    expect(a).toBe(b);
    await a;
    expect(runs).toBe(1);
  });

  it('promoting to priority 0 starts a queued background job before the background gate opens', async () => {
    const q = new JobQueue();
    const order: string[] = [];
    const j = controlled(order, 'rig');
    const p = q.enqueue('rig', 1, 'rig', j.run);
    await tick();
    expect(order).toEqual([]); // held back: background closed
    q.promote('rig', 0);
    await tick();
    expect(order).toEqual(['start rig']);
    j.release();
    await p;
  });

  it('never demotes or re-prioritises a job that already started', async () => {
    const q = new JobQueue();
    const order: string[] = [];
    const j = controlled(order, 'a');
    void q.enqueue('a', 0, 'a', j.run);
    await tick();
    expect(q.promote('a', 0)).toBe(false);
    expect(q.promote('missing', 0)).toBe(false);
    q.enqueue('b', 1, 'b', async () => 'b');
    expect(q.promote('b', 2)).toBe(false); // not an upgrade
    j.release();
  });

  it('a failed job can be requested again', async () => {
    const q = new JobQueue();
    q.openBackground();
    await expect(q.enqueue('k', 0, 'k', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await tick();
    await expect(q.enqueue('k', 0, 'k', async () => 'ok')).resolves.toBe('ok');
  });
});
