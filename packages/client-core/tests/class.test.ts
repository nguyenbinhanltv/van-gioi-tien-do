import { describe, expect, it } from 'vitest';
import { TileGrid } from '@vgtd/sim';
import { encode, type Message } from '@vgtd/protocol';
import { NetClient, type NetDeps, type SocketLike } from '@vgtd/client-core';

/** Class selection on the client side of the wire (D82): hello classId, hello_ack classId, EnterEntity.defId of players. */
class FakeSocket implements SocketLike {
  static last: FakeSocket;
  static ackClass: number | undefined = undefined;
  binaryType = '';
  readyState = 1;
  hello: Record<string, unknown> | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
    queueMicrotask(() => this.onopen?.({}));
  }
  send(d: string | Uint8Array): void {
    if (typeof d !== 'string') return;
    this.hello = JSON.parse(d) as Record<string, unknown>;
    queueMicrotask(() =>
      this.onmessage?.({
        data: JSON.stringify({
          type: 'hello_ack',
          entityId: 1,
          protocol: 4,
          mapTiles: 64,
          ...(FakeSocket.ackClass !== undefined ? { classId: FakeSocket.ackClass } : {}),
        }),
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
};
const make = (classId?: string | number): NetClient =>
  new NetClient({
    baseUrl: 'http://x',
    username: 'u',
    password: 'p',
    deps,
    ...(classId !== undefined ? { classId } : {}),
    makeGrid: (n) => TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
  });

describe('NetClient class selection', () => {
  it('sends the requested class in the hello and keeps the class the server answers', async () => {
    FakeSocket.ackClass = 3;
    const net = make('the');
    await net.connect();
    expect(FakeSocket.last.hello).toMatchObject({ type: 'hello', token: 'tok', classId: 'the' });
    expect(net.classId).toBe(3); // what the server holds, not what we asked for
  });
  it('sends no classId unless one was requested, and classId stays 0 against a server that does not say', async () => {
    FakeSocket.ackClass = undefined;
    const net = make();
    await net.connect();
    expect(FakeSocket.last.hello).not.toHaveProperty('classId');
    expect(net.classId).toBe(0);
  });
  it('classRequest set after construction (after a picker) wins over the constructor option; wire ids are accepted too', async () => {
    FakeSocket.ackClass = 5;
    const net = make('kiem');
    net.classRequest = 5;
    await net.connect();
    expect(FakeSocket.last.hello?.classId).toBe(5);
    expect(net.classId).toBe(5);
  });
  it('a player entering view carries its class wire id in defId', async () => {
    FakeSocket.ackClass = 1;
    const net = make('kiem');
    await net.connect();
    FakeSocket.last.push({
      type: 'aoi_enter',
      entities: [
        { index: 1, entityId: 7, kind: 0, defId: 4, qi: 640, qj: 640, anim: 0, dir: 0, hpPct: 100, maxHp: 1000 },
        { index: 2, entityId: 9, kind: 1, defId: 12, qi: 700, qj: 700, anim: 0, dir: 0, hpPct: 100, maxHp: 500 },
      ],
    });
    expect(
      net
        .remotes()
        .map((r) => [r.entityId, r.kind, r.defId])
        .sort(),
    ).toEqual([
      [7, 0, 4],
      [9, 1, 12],
    ]);
  });
});
