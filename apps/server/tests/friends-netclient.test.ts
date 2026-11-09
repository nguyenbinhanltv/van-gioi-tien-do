/**
 * Friends end to end (D96): real server, real gateway, real NetClients and FriendsModels (what the browser panel runs, minus the DOM),
 * including the whisper / party-invite shortcuts and a restart on the durable file store (D92).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TileGrid } from '@vgtd/sim';
import { FriendReason, type PartyInviteMsg } from '@vgtd/protocol';
import { NetClient, type NetDeps } from '@vgtd/client-core/src/net/index.js'; // engine-free netcode only
import { ChatLog } from '@vgtd/client-core/src/ui/ChatLog.js';
import { FriendsModel } from '@vgtd/client-core/src/ui/FriendsModel.js';
import { FRIENDS_CONFIG, openFileStores, startServer, type FileStores, type RunningServer } from '../src/index.js';
import { TEST_ONLY_GOOD } from './fixtures.js';

const FAST = { N: 1024, r: 8, p: 1 };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(what: string, ok: () => boolean, ms = 10_000): Promise<void> {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
    await sleep(20);
  }
}
let srv: RunningServer | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await srv?.stop();
  srv = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Player {
  name: string;
  net: NetClient;
  chat: ChatLog;
  friends: FriendsModel;
  results: FriendReason[];
  invites: PartyInviteMsg[];
  /** run a chat-box line as the browser does (`/friend ...`, `/w name text`, `/invite name`) */
  say(raw: string): boolean;
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
  const chat = new ChatLog({ myName: () => name });
  const friends = new FriendsModel();
  const results: FriendReason[] = [];
  const invites: PartyInviteMsg[] = [];
  net.chatEvents = {
    onChatMsg: (m) => chat.applyMsg(m),
    onChatResult: (m) => chat.applyResult(m),
  };
  net.partyEvents = { onPartyInvite: (m) => invites.push(m) };
  net.friendEvents = {
    onFriendState: (m) => {
      const line = friends.applyState(m);
      if (line) chat.system(line);
    },
    onFriendResult: (m) => {
      results.push(m.reason);
      const refusal = friends.applyResult(m);
      if (refusal) chat.system(refusal, 'error');
    },
  };
  await net.connect();
  const loop = setInterval(() => net.update(50), 50);
  return {
    name,
    net,
    chat,
    friends,
    results,
    invites,
    say: (raw) =>
      chat.submit(
        raw,
        (m) => net.sendChat(m),
        (m) => net.sendParty(m),
        (m) => net.sendFriend(m),
      ),
    close: () => {
      clearInterval(loop);
      net.close();
    },
  };
}
const SERVER_OPTS = { mapTiles: 128, spawn: { i0: 60, j0: 60, side: 6 } };
async function boot(): Promise<RunningServer> {
  srv = await startServer({
    port: 0,
    auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
    world: SERVER_OPTS,
  });
  return srv;
}

describe('friends end to end (real server, real NetClients)', () => {
  it('request -> accept: both panels fill in, online with class; the whisper and invite shortcuts reach the friend', async () => {
    const s = await boot();
    const a = await player(s, 'fr_alice');
    const b = await player(s, 'fr_bob');
    await until('both have an (empty) friend state', () => a.friends.ready && b.friends.ready);
    expect(a.say('/friend add FR_Bob')).toBe(true);
    await until('bob sees the request', () => b.friends.incoming().includes('fr_alice'));
    expect(a.friends.outgoing()).toEqual(['fr_bob']);
    expect(b.chat.entries.map((e) => e.text).join('\n')).toMatch(/fr_alice muốn kết bạn/);
    expect(b.say('/friend accept fr_alice')).toBe(true);
    await until('both are friends', () => a.friends.isFriend('fr_bob') && b.friends.isFriend('fr_alice'));
    expect(a.friends.friends()).toEqual([expect.objectContaining({ name: 'fr_bob', online: true, canWhisper: true })]);
    expect(b.friends.incoming()).toEqual([]);
    expect(a.results).toEqual([FriendReason.Ok]);

    // shortcuts: "Nhắn riêng" = the whisper input prefilled with the friend's name, "Mời vào tổ đội" = /invite name
    expect(a.say(a.friends.whisperPrefill('fr_bob') + 'xin chào')).toBe(true);
    await until('bob got the whisper', () => b.chat.entries.some((e) => e.text.includes('xin chào')));
    expect(a.say(a.friends.inviteCommand('fr_bob'))).toBe(true);
    await until('bob got the party invite', () => b.invites.length === 1);
    expect(b.invites[0]!.fromName).toBe('fr_alice');
    a.close();
    b.close();
  });

  it('presence: a friend going offline / coming back is reflected in the list without any command', async () => {
    const s = await boot();
    const a = await player(s, 'fr_pres_a');
    let b = await player(s, 'fr_pres_b');
    a.say('/friend add fr_pres_b');
    await until('request arrives', () => b.friends.incoming().length === 1);
    b.say('/friend accept');
    await until('befriended, online', () => a.friends.friends()[0]?.online === true);
    b.close(); // a deliberate close removes the session at once
    await until('bob shown offline', () => a.friends.friends()[0]?.online === false);
    expect(a.friends.friends()[0]).toMatchObject({ name: 'fr_pres_b', classId: 0, canWhisper: false });
    b = await player(s, 'fr_pres_b');
    await until('bob online again', () => a.friends.friends()[0]?.online === true);
    await until('bob got his list on login', () => b.friends.isFriend('fr_pres_a'));
    a.close();
    b.close();
  });

  it('refusals come back as results and as Vietnamese lines; unknown names are rate limited like whispers (no free probing)', async () => {
    const s = await boot();
    const a = await player(s, 'fr_ref_a');
    await until('state', () => a.friends.ready);
    a.say('/friend add fr_ref_a');
    a.say('/friend accept nobody');
    await until('two answers', () => a.results.length === 2);
    expect(a.results).toEqual([FriendReason.Self, FriendReason.NoRequest]);
    expect(a.chat.entries.filter((e) => e.tone === 'error').map((e) => e.text)).toEqual([
      'Không thể tự chọn chính mình.',
      'Không có lời mời kết bạn nào như vậy.',
    ]);
    // probe a lot of unknown names quickly: the burst gets answers, the rest is RateLimited
    const probes = FRIENDS_CONFIG.RATE.burst + 6;
    const before = a.results.length;
    for (let k = 0; k < probes; k++) a.say(`/friend add ghost_${k}`);
    await until('probe answers', () => a.results.length === before + probes);
    const answers = a.results.slice(before);
    expect(answers.filter((r) => r === FriendReason.RateLimited).length).toBeGreaterThanOrEqual(
      probes - FRIENDS_CONFIG.RATE.burst,
    );
    expect(answers.filter((r) => r === FriendReason.NoSuchPlayer).length).toBeLessThanOrEqual(
      FRIENDS_CONFIG.RATE.burst,
    );
    a.close();
  });

  it('a third player who is not part of a friendship sees nothing of it', async () => {
    const s = await boot();
    const a = await player(s, 'fr_res_a');
    const b = await player(s, 'fr_res_b');
    const c = await player(s, 'fr_res_c');
    a.say('/friend add fr_res_b');
    await until('request', () => b.friends.incoming().length === 1);
    b.say('/friend accept');
    await until('friends', () => a.friends.isFriend('fr_res_b'));
    // carol is not part of it: her list stays empty, she never hears about it
    await sleep(200);
    expect([c.friends.count, c.friends.incoming().length, c.friends.outgoing().length]).toEqual([0, 0, 0]);
    a.close();
    b.close();
    c.close();
  });
});

describe('friends survive a server restart on the durable file store (D92)', () => {
  it('friendships and pending requests come back for the same accounts, shown offline until they log in', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-friends-'));
    dirs.push(dir);
    const boot2 = async (): Promise<{ s: RunningServer; stores: FileStores }> => {
      const stores = openFileStores(dir, { flushMs: -1 });
      const s = await startServer({
        port: 0,
        auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000, store: stores.accounts },
        world: SERVER_OPTS,
        progression: { store: stores.progression },
        friends: { store: stores.friends },
      });
      srv = s;
      return { s, stores };
    };
    let { s, stores } = await boot2();
    const a = await player(s, 'fr_keep_a');
    const b = await player(s, 'fr_keep_b');
    const c = await player(s, 'fr_keep_c');
    a.say('/friend add fr_keep_b');
    await until('request', () => b.friends.incoming().length === 1);
    b.say('/friend accept');
    await until('friends', () => a.friends.isFriend('fr_keep_b'));
    a.say('/friend add fr_keep_c'); // stays pending
    await until('pending', () => c.friends.incoming().length === 1);
    a.close();
    b.close();
    c.close();
    await sleep(200);
    await s.stop();
    stores.flush();
    srv = undefined;

    ({ s, stores } = await boot2());
    const a2 = await player(s, 'fr_keep_a'); // same account, new process
    await until('list restored', () => a2.friends.ready && a2.friends.count === 1);
    expect(a2.friends.friends()).toEqual([expect.objectContaining({ name: 'fr_keep_b', online: false })]);
    expect(a2.friends.outgoing()).toEqual(['fr_keep_c']);
    const c2 = await player(s, 'fr_keep_c');
    await until('carol still has the request', () => c2.friends.incoming().includes('fr_keep_a'));
    expect(c2.say('/friend accept fr_keep_a')).toBe(true);
    await until('now friends', () => a2.friends.isFriend('fr_keep_c'));
    // and a restart does not make an offline friend "online" by itself
    void stores;
    a2.close();
    c2.close();
  });
});
