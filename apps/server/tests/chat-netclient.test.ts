import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { TileGrid } from '@vgtd/sim';
import { ChatChannel, ChatReason } from '@vgtd/protocol';
import { NetClient, type NetDeps } from '@vgtd/client-core/src/net/index.js'; // engine-free netcode only
import { ChatLog } from '@vgtd/client-core/src/ui/ChatLog.js';
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
  net.chatEvents = {
    onChatMsg: (m) => log.applyMsg(m),
    onChatHistory: (m) => log.applyHistory(m),
    onChatResult: (m) => log.applyResult(m),
  };
  await net.connect();
  // like the game loop: keep stepping the client so it stays a live, well-behaved connection
  const loop = setInterval(() => net.update(50), 50);
  return {
    name,
    net,
    log,
    say: (raw) => log.submit(raw, (m) => net.sendChat(m)),
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

describe('chat end to end (real server, real NetClients)', () => {
  it('a World line reaches the other player with the sender taken from the connection (the username), and the sender sees it too', async () => {
    const s = await boot();
    const a = await player(s, 'chat_alice');
    const b = await player(s, 'chat_bob');
    try {
      expect(a.say('xin chào cả nhà')).toBe(true);
      await until('bob receives', () => b.texts().length === 1);
      expect(b.texts()).toEqual(['[Thế giới] chat_alice: xin chào cả nhà']);
      await until('alice sees her own line', () => a.texts().length === 1);
      expect(a.net.lastError).toBe('');
    } finally {
      a.close();
      b.close();
    }
  });

  it('whispers go to the target only, with the echo to the sender; /r answers the last whisperer', async () => {
    const s = await boot();
    const a = await player(s, 'whi_alice');
    const b = await player(s, 'whi_bob');
    const c = await player(s, 'whi_carol');
    try {
      a.say('/w whi_bob psst, đừng nói ai');
      await until('bob gets the whisper', () => b.texts().length === 1);
      expect(b.texts()).toEqual(['[Thì thầm] whi_alice → bạn: psst, đừng nói ai']);
      await until('alice gets the echo', () => a.texts().length === 1);
      expect(a.texts()).toEqual(['[Thì thầm] bạn → whi_bob: psst, đừng nói ai']);
      b.say('/r được rồi');
      await until('alice gets the reply', () => a.texts().length === 2);
      expect(a.texts()[1]).toBe('[Thì thầm] whi_bob → bạn: được rồi');
      await sleep(150);
      expect(c.texts()).toEqual([]); // carol never sees a whisper
    } finally {
      a.close();
      b.close();
      c.close();
    }
  });

  it('refusals come back as answers, never silently: unknown whisper target, flood, mute; and a mute can be lifted', async () => {
    const s = await boot();
    const a = await player(s, 'ref_alice');
    const b = await player(s, 'ref_bob');
    try {
      a.say('/w nobody_here hello?');
      await until('no such player', () => a.texts().length === 1);
      expect(a.log.entries[0]).toMatchObject({
        tone: 'error',
        text: 'Không tìm thấy người chơi này (hoặc họ đang ngoại tuyến).',
      });

      for (let k = 0; k < 6; k++) a.say(`flood ${k}`); // World allows a burst of 2
      await until('flood answered', () => a.log.entries.filter((e) => e.tone === 'error').length >= 1 + 4);
      expect(b.texts().filter((t) => t.includes('flood'))).toHaveLength(2);

      const id = s.auth.store.byUsername('ref_bob')!.id;
      s.world.chat!.mute(id, Infinity);
      b.say('/z mute me');
      await until('muted', () => b.log.entries.some((e) => e.text === 'Bạn đang bị cấm chat.'));
      s.world.chat!.unmute(id);
      await sleep(2100); // the zone allowance refills at 1 per 2 s
      b.say('/z back');
      await until('zone line comes back to the sender', () => b.texts().some((t) => t.endsWith('ref_bob: back')));
    } finally {
      a.close();
      b.close();
    }
  }, 20000);

  it('a newcomer sees the recent World lines once (history), and the filter / sanitiser run on the server', async () => {
    const s = await boot();
    const a = await player(s, 'his_alice');
    try {
      a.say('line one‮\nstill line one');
      a.say('say cursewordx please');
      await until('alice sees both', () => a.texts().length === 2);
      expect(a.texts()).toEqual([
        '[Thế giới] his_alice: line one still line one',
        '[Thế giới] his_alice: say ********** please',
      ]);
      const late = await player(s, 'his_late');
      try {
        await until('history arrives', () => late.texts().length === 2);
        expect(late.texts()).toEqual(a.texts());
        await sleep(200);
        expect(late.texts()).toHaveLength(2); // once, not repeated
      } finally {
        late.close();
      }
    } finally {
      a.close();
    }
  });

  it('Zone reaches the players who can see each other (same spawn square) and the codec limits are enforced client-side', async () => {
    const s = await boot();
    const a = await player(s, 'zon_alice');
    const b = await player(s, 'zon_bob');
    try {
      await until(
        'both players are in each other’s view',
        () => a.net.remotes().length === 1 && b.net.remotes().length === 1,
      );
      a.say('/z anyone near?');
      await until('bob hears the zone line', () => b.texts().length === 1);
      expect(b.texts()).toEqual(['[Vùng] zon_alice: anyone near?']);
      // a line over 256 bytes never leaves the client: the parser answers locally
      expect(a.say('đ'.repeat(129))).toBe(false);
      expect(a.log.entries.at(-1)).toMatchObject({ tone: 'error' });
      expect(a.net.lastError).toBe('');
      // the server also refuses the Party channel until parties exist (a raw send, bypassing the parser)
      a.net.sendChat({ channel: ChatChannel.Party, text: 'party?', clientMsgId: 500 });
      await until('party refused', () => a.log.entries.some((e) => e.text === 'Kênh chat này chưa mở.'));
      expect(ChatReason.BadChannel).toBe(5);
    } finally {
      a.close();
      b.close();
    }
  });
});
