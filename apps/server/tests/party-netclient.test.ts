import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { TileGrid } from '@vgtd/sim';
import { PARTY } from '@vgtd/shared';
import { NetClient, type NetDeps } from '@vgtd/client-core/src/net/index.js'; // engine-free netcode only
import { ChatLog } from '@vgtd/client-core/src/ui/ChatLog.js';
import { PartyModel } from '@vgtd/client-core/src/ui/PartyModel.js';
import { startServer, type RunningServer } from '../src/index.js';
import { TEST_ONLY_GOOD } from './fixtures.js';

/** Real server, real gateway, real NetClients and ChatLogs: what the browser chat box runs, minus the DOM. */
const FAST = { N: 1024, r: 8, p: 1 };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(what: string, ok: () => boolean, ms = 8000): Promise<void> {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
    await sleep(20);
  }
}
let srv: RunningServer | undefined;
afterEach(async () => {
  await srv?.stop();
  srv = undefined;
});

interface Player {
  name: string;
  net: NetClient;
  log: ChatLog;
  party: PartyModel;
  say(raw: string): boolean;
  texts(): string[];
  close(): void;
}
async function player(s: RunningServer, name: string): Promise<Player> {
  const deps: NetDeps = {
    fetch: (url, init) => fetch(url, init),
    WebSocket: WebSocket as unknown as NetDeps['WebSocket'],
    now: () => performance.now(),
  };
  const net = new NetClient({
    baseUrl: `http://127.0.0.1:${s.port}`,
    username: name,
    password: TEST_ONLY_GOOD,
    deps,
    makeGrid: (n) => TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
  });
  const log = new ChatLog({ myName: () => name });
  const party = new PartyModel({ myId: () => net.entityId, now: () => performance.now() });
  net.chatEvents = {
    onChatMsg: (m) => log.applyMsg(m),
    onChatHistory: (m) => log.applyHistory(m),
    onChatResult: (m) => log.applyResult(m),
  };
  net.partyEvents = {
    onPartyState: (m) => {
      const line = party.applyState(m);
      if (line) log.system(line, 'party');
    },
    onPartyVitals: (m) => party.applyVitals(m),
    onPartyInvite: (m) => log.system(party.applyInvite(m), 'party'),
    onPartyResult: (m) => {
      const t = party.applyResult(m);
      if (t) log.system(t, 'error');
    },
  };
  await net.connect();
  // like the game loop: keep stepping the client so it stays a live, well-behaved connection
  const loop = setInterval(() => net.update(50), 50);
  return {
    name,
    net,
    log,
    party,
    say: (raw) =>
      log.submit(
        raw,
        (m) => net.sendChat(m),
        (m) => net.sendParty(m),
      ),
    texts: () => log.entries.map((e) => e.text),
    close: () => {
      clearInterval(loop);
      net.close();
    },
  };
}
async function boot(): Promise<RunningServer> {
  srv = await startServer({
    port: 0,
    auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
    world: { mapTiles: 128, spawn: { i0: 60, j0: 60, side: 6 } },
  });
  return srv;
}

describe('party end to end (real server, real NetClients, PartyModel and ChatLog)', () => {
  it('invite, accept, roster, vitals, party chat, kick, leave: the whole loop over real sockets', async () => {
    const s = await boot();
    const a = await player(s, 'pty_alice');
    const b = await player(s, 'pty_bob');
    const c = await player(s, 'pty_carol');
    try {
      a.say('/invite pty_bob');
      await until('bob sees the invite', () => b.party.invite()?.fromName === 'pty_alice');
      expect(b.texts().at(-1)).toContain('pty_alice mời bạn vào tổ đội');
      b.say('/accept');
      await until('both in a party', () => a.party.inParty && b.party.inParty);
      expect(a.party.amLeader).toBe(true);
      expect(b.party.amLeader).toBe(false);
      expect(b.party.members().map((m) => m.name)).toEqual(['pty_alice', 'pty_bob']);
      expect(b.party.invite()).toBeNull();
      expect(b.texts().at(-1)).toBe('Bạn đã vào tổ đội của pty_alice (2/' + PARTY.MAX_SIZE + ').');

      // vitals arrive without anyone asking
      await until('vitals', () => b.party.members().every((m) => (m.hpMax ?? 0) > 0));
      expect(a.party.members().every((m) => (m.hp ?? 0) > 0)).toBe(true);

      // party chat reaches members only
      a.say('/p pull left');
      await until('bob hears the party', () => b.texts().includes('[Đội] pty_alice: pull left'));
      await sleep(150);
      expect(c.texts().some((t) => t.includes('pull left'))).toBe(false);
      c.say('/p let me in');
      await until('carol refused', () => c.texts().includes('Bạn chưa vào tổ đội nào.'));

      // a member cannot kick; the leader can
      b.say('/kick pty_alice');
      await until('only leader', () => b.texts().includes('Chỉ đội trưởng mới làm được việc này.'));
      a.say('/invite pty_carol');
      await until('carol invited', () => c.party.invite() !== null);
      c.say('/accept pty_alice');
      await until('three members', () => a.party.members().length === 3 && c.party.members().length === 3);
      a.say('/kick pty_bob');
      await until('bob out', () => !b.party.inParty && b.texts().includes('Bạn đã rời tổ đội.'));
      await until(
        'roster shrinks for the others',
        () => a.party.members().length === 2 && c.party.members().length === 2,
      );

      // the leader leaving hands the party to the longest-standing member; a party of one disbands
      a.say('/leave');
      await until('alice out, carol alone', () => !a.party.inParty && !c.party.inParty);
      expect(a.net.lastError).toBe('');
    } finally {
      a.close();
      b.close();
      c.close();
    }
  }, 30000);

  it('unknown names, flood and a decline are all answered', async () => {
    const s = await boot();
    const a = await player(s, 'pfl_alice');
    const b = await player(s, 'pfl_bob');
    try {
      a.say('/invite nobody_here');
      await until('no such player', () =>
        a.texts().includes('Không tìm thấy người chơi này (hoặc họ đang ngoại tuyến).'),
      );
      a.say('/invite pfl_bob');
      await until('invited', () => b.party.invite() !== null);
      b.say('/decline pfl_alice');
      await sleep(200);
      b.say('/accept');
      await until('invite is gone', () => b.texts().includes('Không có lời mời nào còn hiệu lực.'));
      expect(b.party.inParty).toBe(false);
      for (let k = 0; k < 12; k++) a.say('/invite nobody_here');
      await until('flood answered', () => a.texts().some((t) => t === 'Bạn thao tác quá nhanh, hãy chờ giây lát.'));
    } finally {
      a.close();
      b.close();
    }
  }, 20000);
});
