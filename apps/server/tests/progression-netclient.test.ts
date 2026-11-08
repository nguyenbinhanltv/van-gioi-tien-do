import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { TileGrid } from '@vgtd/sim';
// engine-free parts only (the package index also pulls DOM input code, which the server's tsconfig has no lib for)
import { NetClient, type NetDeps, type SocketLike } from '@vgtd/client-core/src/net/index.js';
import { ProgressionView, requestIdFrom, type ProgressionCommand } from '@vgtd/client-core/src/ui/ProgressionView.js';
import { startServer, type RunningServer } from '../src/index.js';

/**
 * End to end over a real WebSocket: the client-core NetClient + ProgressionView (the model behind the HUD) against the real
 * gateway / World Node / ProgressionService. `devTuViSpeed` only shortens the waiting; every rule is the production one.
 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until<T>(what: string, get: () => T | null | undefined | false, timeoutMs = 15000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = get();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout: ${what}`);
    await sleep(25);
  }
}

let server: RunningServer | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function startServerWith(speed: number): Promise<RunningServer> {
  server = await startServer({
    port: 0,
    autoTick: true,
    auth: { scrypt: { N: 1024, r: 8, p: 1 }, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
    world: { mapTiles: 64, spawn: { i0: 20, j0: 20, side: 16 } },
    progression: { seed: 42, devTuViSpeed: speed },
  });
  return server;
}
interface Creds {
  username: string;
  password: string;
}
const newCreds = (): Creds => ({
  username: `hud_${Math.floor(Math.random() * 1e6)}`,
  password: requestIdFrom(Math.random),
});

async function connectClient(srv: RunningServer, creds: Creds = newCreds()) {
  const deps: NetDeps = {
    fetch: (url, init) => fetch(url, init),
    WebSocket: WebSocket as unknown as new (url: string) => SocketLike,
    now: () => performance.now(),
  };
  const net = new NetClient({
    baseUrl: `http://127.0.0.1:${srv.port}`,
    ...creds,
    deps,
    makeGrid: (n) => TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
  });
  const view = new ProgressionView({ now: () => performance.now(), newRequestId: () => requestIdFrom(Math.random) });
  net.progressionEvents = {
    onCharState: (m) => view.applyCharState(m),
    onMeditateResult: (m) => view.applyMeditateResult(m),
    onBreakthroughResult: (m) => view.applyBreakthroughResult(m),
  };
  await net.connect();
  const send = (m: ProgressionCommand): boolean =>
    m.type === 'breakthrough_start'
      ? net.sendBreakthrough(m.requestId)
      : net.sendMeditate(m.type === 'meditate_start', m.requestId);
  // like the game loop: step the client in real time so it keeps sending inputs (idle or moving)
  let moving = false;
  const loop = setInterval(
    () => net.update(50, moving ? { dir: 0, mag: 15, flags: 0 } : { dir: 255, mag: 0, flags: 0 }),
    50,
  );
  return {
    net,
    view,
    send,
    creds,
    setMoving: (m: boolean) => (moving = m),
    stop: () => {
      clearInterval(loop);
      net.close();
    },
  };
}
async function rig(speed: number) {
  return connectClient(await startServerWith(speed));
}

describe('progression HUD model over a real socket', () => {
  it('char_state arrives, meditation runs on the server, the stage fills by itself and a minor breakthrough succeeds', async () => {
    const x = await rig(2000);
    try {
      const first = await until('first char_state', () => x.view.state);
      expect(first).toMatchObject({ stage: 1, label: 'Luyện Khí tầng 1', tuVi: 0, tuViReq: 1000, meditating: false });
      expect(x.view.canMeditate()).toBe(true);
      expect(x.view.canBreakthrough()).toBe(false);

      expect(x.view.toggleMeditate(x.send)).toBe(true);
      const sitting = await until('meditating state from the server', () => x.view.state?.meditating && x.view.state);
      expect(sitting.tuVi).toBeGreaterThanOrEqual(0);
      const full = await until(
        'stage full, meditation stops by itself',
        () => x.view.state?.ready && x.view.state,
        30000,
      );
      expect(full).toMatchObject({ meditating: false, fraction: 1 });
      expect(x.view.canBreakthrough()).toBe(true);

      // a failed roll keeps the tu vi, so retry after the cooldown until it works (90%)
      let advanced = false;
      for (let attempt = 0; attempt < 6 && !advanced; attempt++) {
        expect(x.view.attemptBreakthrough(x.send)).toBe(true);
        await until('breakthrough answered', () => !x.view.breakthroughBusy());
        await sleep(100);
        advanced = (x.view.state?.stage ?? 1) === 2;
        if (!advanced) await sleep(3300); // BREAKTHROUGH_COOLDOWN_MS
      }
      expect(advanced).toBe(true);
      expect(x.view.state).toMatchObject({
        stage: 2,
        label: 'Luyện Khí tầng 3'.replace('3', '2'),
        tuVi: 0,
        ready: false,
      });
      expect(x.view.currentToast()).toMatchObject({ tone: 'good' });
      expect(x.net.lastError).toBe('');
    } finally {
      x.stop();
    }
  }, 40000);

  it('moving interrupts meditation on the server and the HUD model follows', async () => {
    const x = await rig(1);
    try {
      await until('first char_state', () => x.view.state);
      x.view.toggleMeditate(x.send);
      await until('meditating', () => x.view.state?.meditating);
      x.setMoving(true);
      await until('server interrupted the meditation', () => x.view.state && !x.view.state.meditating, 5000);
      // while moving, starting again is refused by the server and the reason is shown
      await sleep(300);
      expect(x.view.canMeditate()).toBe(true);
      x.view.toggleMeditate(x.send);
      await until('refusal toast', () => x.view.currentToast());
      expect(x.view.currentToast()).toMatchObject({ tone: 'info', text: expect.stringContaining('di chuyển') });
      expect(x.view.state!.meditating).toBe(false);
      x.setMoving(false);
    } finally {
      x.stop();
    }
  }, 30000);

  it('at a major threshold the server refuses with TribulationRequired and the toast says so', async () => {
    const srv = await startServerWith(1);
    const first = await connectClient(srv);
    await until('first char_state', () => first.view.state);
    const characterId = srv.world.progression!.recordOf(first.net.entityId)!.characterId;
    first.stop();
    await sleep(300); // leave() writes the record
    // put the character on Luyen Khi tang 9 with a full stage directly in the store, then log in again
    const store = srv.world.progression!.store;
    const rec = (await store.load(characterId))!;
    expect(rec.realm).toBe(1);
    expect(await store.save({ ...rec, subRealm: 9, exp: 1e9, version: rec.version + 1 }, rec.version)).toBe(true);
    const again = await connectClient(srv, first.creds);
    try {
      const s = await until('state of the edited character', () => again.view.state?.ready && again.view.state, 10000);
      expect(s.label).toBe('Luyện Khí tầng 9');
      expect(again.view.attemptBreakthrough(again.send)).toBe(true);
      await until('refusal toast', () => again.view.currentToast());
      expect(again.view.currentToast()).toMatchObject({ tone: 'bad', text: expect.stringContaining('Tâm Ma') });
      expect(again.view.state).toMatchObject({ stage: 9, ready: true });
    } finally {
      again.stop();
    }
  }, 30000);
});
