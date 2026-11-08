import { describe, expect, it } from 'vitest';
import { TileGrid } from '@vgtd/sim';
import { InvOp, InvReason, decode, encode, type InvResultMsg, type InvStateMsg, type Message } from '@vgtd/protocol';
import { BagModel, NetClient, invReasonText, makeRequestId, type NetDeps, type SocketLike } from '@vgtd/client-core';

const STATE: InvStateMsg = {
  type: 'inv_state',
  wallet: [12, 3, 1],
  slots: [
    { kind: 'stack', defId: 1, quality: 2, qty: 5 },
    null,
    { kind: 'instance', defId: 5, quality: 5, durability: 8000, bound: false },
    null,
  ],
  pending: [{ defId: 6, quality: 0, qty: 30 }],
};
let n = 0;
const ids = (): string => `${(++n).toString(16).padStart(32, '0')}`;

describe('BagModel', () => {
  it('applies inv_state: wallet by currency, items by slot, free slots, pending total', () => {
    const b = new BagModel();
    expect(b.ready).toBe(false);
    b.applyState(STATE);
    expect(b.ready).toBe(true);
    expect(b.wallet).toEqual({ LT_HA: 12, LT_TRUNG: 3, LT_THUONG: 1 });
    expect(b.slotCount).toBe(4);
    expect(b.itemAt(0)).toMatchObject({ kind: 'stack', key: 'heal_pill', quality: 2, qty: 5, durability: null });
    expect(b.itemAt(1)).toBeNull();
    expect(b.itemAt(2)).toMatchObject({ kind: 'instance', key: 'blueprint_gold_red', qty: 1, durability: 8000, bound: false });
    expect(b.itemAt(99)).toBeNull();
    expect(b.freeSlots()).toBe(2);
    expect(b.pendingTotal).toBe(30);
  });

  it('keeps an unknown item id usable (key undefined) instead of throwing', () => {
    const b = new BagModel();
    b.applyState({ ...STATE, slots: [{ kind: 'stack', defId: 4000, quality: 0, qty: 1 }] });
    expect(b.itemAt(0)).toMatchObject({ defId: 4000, key: undefined });
  });

  it('builds a move command only when it can make sense, remembers it, and the result clears it', () => {
    const b = new BagModel();
    expect(b.moveCmd(0, 1, ids)).toBeNull(); // nothing loaded yet
    b.applyState(STATE);
    expect(b.moveCmd(1, 0, ids)).toBeNull(); // empty source
    expect(b.moveCmd(0, 0, ids)).toBeNull(); // same slot
    expect(b.moveCmd(0, 9, ids)).toBeNull(); // outside the bag
    const cmd = b.moveCmd(0, 3, ids)!;
    expect(cmd).toMatchObject({ type: 'inv_cmd', op: InvOp.Move, from: 0, to: 3 });
    expect(b.waitingCount).toBe(1);
    const res: InvResultMsg = { type: 'inv_result', requestId: cmd.requestId, op: InvOp.Move, reason: InvReason.Ok, count: 0 };
    expect(b.applyResult(res)).toEqual(cmd);
    expect(b.waitingCount).toBe(0);
    expect(b.lastResult).toMatchObject({ reason: InvReason.Ok });
    expect(b.applyResult(res)).toBeUndefined(); // an answer to nothing
  });

  it('claim needs pending loot; the model never edits the bag itself (the server state is the truth)', () => {
    const b = new BagModel();
    b.applyState({ ...STATE, pending: [] });
    expect(b.claimCmd(ids)).toBeNull();
    b.applyState(STATE);
    const cmd = b.claimCmd(ids)!;
    expect(cmd).toMatchObject({ op: InvOp.ClaimPending, from: 0, to: 0 });
    expect(b.itemAt(0)!.qty).toBe(5); // unchanged until the next inv_state
    b.moveCmd(0, 3, ids);
    expect(b.itemAt(0)!.qty).toBe(5);
    expect(b.itemAt(3)).toBeNull();
  });

  it('reset forgets everything; request ids are 32 lowercase hex characters; reasons have text', () => {
    const b = new BagModel();
    b.applyState(STATE);
    b.moveCmd(0, 3, ids);
    b.reset();
    expect([b.ready, b.slotCount, b.waitingCount, b.lastResult]).toEqual([false, 0, 0, null]);
    let k = 0.1;
    const id = makeRequestId(() => (k = (k * 7.7) % 1));
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(invReasonText(InvReason.EmptySlot)).toBe('nothing in that slot');
    expect(invReasonText(200)).toContain('200');
  });
});

// ---------------------------------------------------------------------------------------------- through NetClient
class FakeSocket implements SocketLike {
  static last: FakeSocket;
  binaryType = '';
  readyState = 1;
  sent: (string | Uint8Array)[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
    queueMicrotask(() => this.onopen?.({}));
  }
  send(d: string | Uint8Array): void {
    this.sent.push(d);
    if (typeof d === 'string')
      queueMicrotask(() =>
        this.onmessage?.({
          data: JSON.stringify({ type: 'hello_ack', entityId: 1, serverTimeMs: 0, tickHz: 20, protocol: 4, mapTiles: 64 }),
        }),
      );
  }
  close(): void {
    this.readyState = 3;
  }
  push(m: Message): void {
    const b = encode(m);
    this.onmessage?.({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
  }
}
const deps: NetDeps = {
  fetch: async (url) => ({ status: url.endsWith('/auth/register') ? 201 : 200, json: async () => ({ token: 'tok' }) }),
  WebSocket: FakeSocket as unknown as NetDeps['WebSocket'],
  now: () => 1000,
  random: (() => {
    let s = 0.37;
    return () => (s = (s * 9301 + 0.49297) % 1);
  })(),
};
async function client(events = {}): Promise<{ net: NetClient; sock: FakeSocket }> {
  const net = new NetClient({
    baseUrl: 'http://x',
    username: 'u',
    password: 'p',
    deps,
    makeGrid: (m) => TileGrid.fromRows(Array.from({ length: m }, () => '.'.repeat(m))),
    events,
  });
  await net.connect();
  return { net, sock: FakeSocket.last };
}

describe('NetClient bag wiring', () => {
  it('inv_state updates net.bag and fires onInventory; sendBagMove sends a decodable inv_cmd; inv_result clears it and fires onInvResult', async () => {
    const seen: string[] = [];
    const { net, sock } = await client({
      onInventory: () => seen.push('state'),
      onInvResult: (m: InvResultMsg) => seen.push(`result:${m.reason}`),
    });
    expect(net.sendBagMove(0, 3)).toBe(false); // nothing loaded yet: nothing sent
    sock.push(STATE);
    expect(net.bag.ready).toBe(true);
    expect(net.bag.itemAt(0)!.key).toBe('heal_pill');
    const before = sock.sent.length;
    expect(net.sendBagMove(0, 3)).toBe(true);
    const frame = sock.sent[before] as Uint8Array;
    const cmd = decode(frame);
    expect(cmd).toMatchObject({ type: 'inv_cmd', op: InvOp.Move, from: 0, to: 3 });
    expect(net.bag.waitingCount).toBe(1);
    sock.push({ type: 'inv_result', requestId: (cmd as { requestId: string }).requestId, op: InvOp.Move, reason: InvReason.Ok, count: 0 });
    expect(net.bag.waitingCount).toBe(0);
    expect(seen).toEqual(['state', `result:${InvReason.Ok}`]);
    // claim
    expect(net.sendBagClaim()).toBe(true);
    expect(decode(sock.sent[sock.sent.length - 1] as Uint8Array)).toMatchObject({ type: 'inv_cmd', op: InvOp.ClaimPending });
  });

  it('a throwing hook never breaks the session, and a closed socket refuses commands and clears the bag', async () => {
    const { net, sock } = await client({
      onInventory: () => {
        throw new Error('boom');
      },
    });
    sock.push(STATE);
    expect(net.bag.ready).toBe(true); // applied before the hook ran
    expect(net.lastError).toContain('boom');
    sock.readyState = 3;
    sock.onclose?.({ code: 1000, reason: 'bye' });
    expect(net.bag.ready).toBe(false);
    expect(net.sendBagMove(0, 3)).toBe(false);
    expect(net.sendBagClaim()).toBe(false);
  });
});
