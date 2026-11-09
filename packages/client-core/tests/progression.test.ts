import { describe, expect, it } from 'vitest';
import { TileGrid } from '@vgtd/sim';
import {
  BreakthroughKind,
  BreakthroughOutcome,
  CHAR_FLAG,
  ProgressionReason,
  decode,
  encode,
  type BreakthroughResultMsg,
  type CharStateMsg,
  type Message,
} from '@vgtd/protocol';
import {
  NetClient,
  PROGRESSION_REASON_KEY,
  ProgressionView,
  reasonText,
  requestIdFrom,
  type NetDeps,
  type ProgressionCommand,
  type SocketLike,
} from '@vgtd/client-core';

const charState = (o: Partial<CharStateMsg> = {}): CharStateMsg => ({
  type: 'char_state',
  stage: 3,
  flags: 0,
  nFail: 0,
  rootType: 2,
  elements: 0b00111,
  mutation: 0,
  karma: 0,
  tuVi: 500,
  tuViReq: 2000,
  ...o,
});
const REQ = (n: number) => n.toString(16).padStart(32, '0');
function view() {
  let t = 1000;
  let n = 0;
  const v = new ProgressionView({ now: () => t, newRequestId: () => REQ(++n) });
  return { v, advance: (ms: number) => (t += ms), sent: [] as ProgressionCommand[] };
}
const sendTo =
  (sent: ProgressionCommand[], ok = true) =>
  (m: ProgressionCommand) => {
    sent.push(m);
    return ok;
  };

describe('ProgressionView (mirror of the server state)', () => {
  it('has no state before the first char_state and offers no command', () => {
    const { v, sent } = view();
    expect(v.state).toBeNull();
    expect(v.canMeditate()).toBe(false);
    expect(v.canBreakthrough()).toBe(false);
    expect(v.toggleMeditate(sendTo(sent))).toBe(false);
    expect(sent).toEqual([]);
    expect(v.statusLine()).toContain('đang tải');
  });

  it('maps char_state: label, realm / sub-stage, fraction and flags', () => {
    const { v } = view();
    v.applyCharState(charState({ stage: 12, flags: CHAR_FLAG.MEDITATING, tuVi: 250, tuViReq: 1000 }));
    expect(v.state).toMatchObject({
      stage: 12,
      label: 'Trúc Cơ hậu kỳ',
      realm: 2,
      subRealm: 3,
      fraction: 0.25,
      meditating: true,
      ready: false,
      maxStage: false,
    });
    expect(v.statusLine()).toBe('Trúc Cơ hậu kỳ · đang đả tọa 250/1000');
    v.applyCharState(charState({ stage: 1, flags: 0, tuVi: 5000, tuViReq: 1000 }));
    expect(v.state!.fraction).toBe(1); // clamped
    v.applyCharState(charState({ stage: 41, flags: CHAR_FLAG.MAX_STAGE, tuVi: 0, tuViReq: 0 }));
    expect(v.state).toMatchObject({ label: 'Độ Kiếp Viên Mãn', maxStage: true, fraction: 0 });
  });

  it('meditate toggle sends start or stop from the server state, one in flight at a time', () => {
    const { v, sent } = view();
    v.applyCharState(charState());
    expect(v.canMeditate()).toBe(true);
    expect(v.toggleMeditate(sendTo(sent))).toBe(true);
    expect(sent).toEqual([{ type: 'meditate_start', requestId: REQ(1) }]);
    expect(v.toggleMeditate(sendTo(sent))).toBe(false); // waiting for the answer
    v.applyMeditateResult({ type: 'meditate_result', requestId: REQ(1), meditating: true, reason: 0 });
    v.applyCharState(charState({ flags: CHAR_FLAG.MEDITATING }));
    expect(v.toggleMeditate(sendTo(sent))).toBe(true);
    expect(sent[1]).toEqual({ type: 'meditate_stop', requestId: REQ(2) });
  });

  it('a lost reply does not lock the button forever (pending timeout)', () => {
    const { v, sent, advance } = view();
    v.applyCharState(charState());
    v.toggleMeditate(sendTo(sent));
    advance(4999);
    expect(v.canMeditate()).toBe(false);
    advance(2);
    expect(v.canMeditate()).toBe(true);
  });

  it('an answer to another request id does not clear the pending command', () => {
    const { v, sent } = view();
    v.applyCharState(charState());
    v.toggleMeditate(sendTo(sent));
    v.applyMeditateResult({ type: 'meditate_result', requestId: REQ(99), meditating: false, reason: 0 });
    expect(v.meditateBusy()).toBe(true);
  });

  it('a full stage disables meditation and enables the breakthrough; maxed stage disables both starts', () => {
    const { v, sent } = view();
    v.applyCharState(charState({ flags: CHAR_FLAG.BREAKTHROUGH_READY, tuVi: 2000 }));
    expect(v.canMeditate()).toBe(false);
    expect(v.canBreakthrough()).toBe(true);
    expect(v.statusLine()).toContain('có thể đột phá');
    expect(v.attemptBreakthrough(sendTo(sent))).toBe(true);
    expect(sent).toEqual([{ type: 'breakthrough_start', requestId: REQ(1) }]);
    expect(v.canBreakthrough()).toBe(false); // in flight
    v.applyCharState(charState({ stage: 41, flags: CHAR_FLAG.MAX_STAGE | CHAR_FLAG.BREAKTHROUGH_READY }));
    expect(v.canBreakthrough()).toBe(false);
    expect(v.canMeditate()).toBe(false);
  });

  it('breakthrough is not offered before the server says the tu vi is full (no client-side prediction)', () => {
    const { v, sent } = view();
    v.applyCharState(charState({ tuVi: 1999, tuViReq: 2000 }));
    expect(v.canBreakthrough()).toBe(false);
    expect(v.attemptBreakthrough(sendTo(sent))).toBe(false);
    expect(sent).toEqual([]);
  });

  it('a closed socket refuses locally and says so', () => {
    const { v, sent } = view();
    v.applyCharState(charState());
    expect(v.toggleMeditate(sendTo(sent, false))).toBe(false);
    expect(v.currentToast()?.text).toContain('Chưa kết nối');
    expect(v.canMeditate()).toBe(true); // nothing is pending after a failed send
  });

  it('turns breakthrough answers into toasts that expire', () => {
    const { v, advance } = view();
    const result = (o: Partial<BreakthroughResultMsg>): BreakthroughResultMsg => ({
      type: 'breakthrough_result',
      requestId: REQ(1),
      outcome: BreakthroughOutcome.Success,
      kind: BreakthroughKind.Minor,
      reason: 0,
      fromStage: 1,
      toStage: 2,
      chance: 9000,
      nFail: 0,
      ...o,
    });
    v.applyBreakthroughResult(result({}));
    expect(v.currentToast()).toMatchObject({ tone: 'good' });
    expect(v.currentToast()!.text).toBe('Đột phá tiểu cảnh thành công: Luyện Khí tầng 2 (tỉ lệ 90%).');
    advance(3999);
    expect(v.currentToast()).not.toBeNull();
    advance(2);
    expect(v.currentToast()).toBeNull();
    v.applyBreakthroughResult(
      result({ outcome: BreakthroughOutcome.Failure, kind: BreakthroughKind.Major, toStage: 9, chance: 7850 }),
    );
    expect(v.currentToast()).toMatchObject({ tone: 'bad' });
    expect(v.currentToast()!.text).toContain('đại cảnh thất bại (tỉ lệ 78.5%)');
    v.applyBreakthroughResult(
      result({ outcome: BreakthroughOutcome.Rejected, reason: ProgressionReason.TribulationRequired, chance: 0 }),
    );
    expect(v.currentToast()!.text).toBe(reasonText(ProgressionReason.TribulationRequired));
  });

  it('a rejected meditation shows its reason; accepted ones show nothing', () => {
    const { v } = view();
    v.applyMeditateResult({ type: 'meditate_result', requestId: REQ(1), meditating: false, reason: ProgressionReason.Moving });
    expect(v.currentToast()).toMatchObject({ tone: 'info', text: reasonText(ProgressionReason.Moving) });
    const quiet = view().v;
    quiet.applyMeditateResult({ type: 'meditate_result', requestId: REQ(1), meditating: true, reason: 0 });
    expect(quiet.currentToast()).toBeNull();
  });

  it('every wire reason has a Vietnamese text and unknown codes get a fallback', () => {
    for (const k of Object.keys(ProgressionReason).filter((x) => /^\d+$/.test(x)).map(Number)) {
      expect(k in PROGRESSION_REASON_KEY, `reason ${k}`).toBe(true);
      if (k !== ProgressionReason.Ok) expect(reasonText(k).length).toBeGreaterThan(5);
    }
    expect(reasonText(200)).toBe('Bị từ chối (mã 200).');
  });

  it('requestIdFrom builds 32 lowercase hex characters from any rng and is deterministic', () => {
    let s = 7;
    const rng = () => ((s = (s * 48271) % 2147483647) / 2147483647);
    const a = requestIdFrom(rng);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    s = 7;
    expect(requestIdFrom(rng)).toBe(a);
  });
});

// ---------------------------------------------------------------- NetClient wiring
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
};
async function connected(): Promise<{ net: NetClient; sock: FakeSocket }> {
  const net = new NetClient({
    baseUrl: 'http://x',
    username: 'u',
    password: 'p',
    deps,
    makeGrid: (n) => TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
  });
  await net.connect();
  return { net, sock: FakeSocket.last };
}

describe('NetClient progression hooks', () => {
  it('delivers char_state / meditate_result / breakthrough_result, survives `events` being replaced, and isolates a throwing hook', async () => {
    const { net, sock } = await connected();
    const log: string[] = [];
    net.progressionEvents = {
      onCharState: (m) => log.push(`state ${m.stage}`),
      onMeditateResult: (m) => log.push(`med ${m.meditating}`),
      onBreakthroughResult: (m) => {
        log.push(`bt ${m.outcome}`);
        throw new Error('boom');
      },
    };
    net.events = {}; // combat attaching later replaces the whole events object
    sock.push(charState({ stage: 4 }));
    sock.push({ type: 'meditate_result', requestId: REQ(1), meditating: true, reason: 0 });
    sock.push({
      type: 'breakthrough_result',
      requestId: REQ(2),
      outcome: 2,
      kind: 1,
      reason: 0,
      fromStage: 4,
      toStage: 4,
      chance: 9000,
      nFail: 0,
    });
    sock.push(charState({ stage: 5 }));
    expect(log).toEqual(['state 4', 'med true', 'bt 2', 'state 5']);
    expect(net.lastError).toBe('hook: boom');
    expect(net.status).toBe('online');
  });

  it('sends meditate_start / meditate_stop / breakthrough_start as protocol frames, and refuses when the socket is closed', async () => {
    const { net, sock } = await connected();
    const frames = () => sock.sent.filter((x): x is Uint8Array => typeof x !== 'string').map((b) => decode(b));
    expect(net.sendMeditate(true, REQ(1))).toBe(true);
    expect(net.sendMeditate(false, REQ(2))).toBe(true);
    expect(net.sendBreakthrough(REQ(3))).toBe(true);
    expect(frames()).toEqual([
      { type: 'meditate_start', requestId: REQ(1) },
      { type: 'meditate_stop', requestId: REQ(2) },
      { type: 'breakthrough_start', requestId: REQ(3) },
    ]);
    sock.readyState = 3;
    expect(net.sendMeditate(true, REQ(4))).toBe(false);
    expect(net.sendBreakthrough(REQ(5))).toBe(false);
  });
});
