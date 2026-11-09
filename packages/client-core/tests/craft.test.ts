import { describe, expect, it } from 'vitest';
import { ALCHEMY, itemDefByKey, recipeByKey } from '@vgtd/shared';
import { CraftOutcome, CraftReason, type CraftResultMsg, type CraftStateMsg } from '@vgtd/protocol';
import { CRAFT_REASON_TEXT, CraftModel, CraftOp } from '@vgtd/client-core';

const MAT = itemDefByKey('craft_material')!.id;
const REQ = (n: number): string => n.toString(16).padStart(32, '0');
const state = (o: Partial<CraftStateMsg> = {}): CraftStateMsg => ({
  type: 'craft_state',
  furnaceQi: 40 * 32,
  furnaceQj: 40 * 32,
  job: { recipeId: 0, done: 0, total: 0, remainingMs: 0 },
  mastery: [],
  ...o,
});
const result = (o: Partial<CraftResultMsg>): CraftResultMsg => ({
  type: 'craft_result',
  requestId: REQ(1),
  index: 255,
  outcome: CraftOutcome.Accepted,
  reason: 0,
  recipeId: 2,
  quality: 0,
  qty: 0,
  lost: 0,
  ...o,
});
function model(o: { realm?: number | null; have?: number; stones?: number } = {}) {
  let t = 1000;
  let n = 0;
  const m = new CraftModel({
    now: () => t,
    newRequestId: () => REQ(++n),
    bagCount: (id) => (id === MAT ? (o.have ?? 100) : 0),
    stones: () => o.stones ?? 1000,
    realm: () => (o.realm === undefined ? 2 : o.realm),
  });
  return { m, advance: (ms: number) => (t += ms) };
}
const sendTo =
  (sent: unknown[], ok = true) =>
  (x: unknown) => {
    sent.push(x);
    return ok;
  };

describe('CraftModel', () => {
  it('has no state before the first craft_state and says it is loading', () => {
    const { m } = model();
    expect(m.ready).toBe(false);
    expect(m.statusLine(null)).toContain('Đang tải');
  });

  it('shows the docs/13 numbers per recipe: chance at the current mastery, fee, materials, quality ceiling', () => {
    const { m } = model();
    m.applyState(state({ mastery: [{ recipeId: recipeByKey('pill_truc_co_dan')!.wireId, points: 60 }] }));
    const v = m.recipes({ i: 40, j: 40 });
    const tc = v.find((r) => r.key === 'pill_truc_co_dan')!;
    expect(tc).toMatchObject({ tier: 1, difficulty: 3, materials: 15, fee: 34, mastery: 60, score: 1, capName: 'Tím' });
    expect(tc.chance).toBeCloseTo(0.83, 12); // 0,81 + 0,02 x 1
    expect(v.find((r) => r.key === 'pill_hoi_huyet_dan')!.chance).toBeCloseTo(0.95, 12);
  });

  it('canStart is only a hint: needs realm, stock, stones, the furnace in range and no running job', () => {
    const near = { i: 40, j: 40 };
    const far = { i: 40 + ALCHEMY.FURNACE_RANGE_TILES + 1, j: 40 };
    const can = (o: Parameters<typeof model>[0], pos = near): boolean => {
      const { m } = model(o);
      m.applyState(state());
      return m.recipes(pos).find((r) => r.key === 'pill_truc_co_dan')!.canStart;
    };
    expect(can({})).toBe(true);
    expect(can({ realm: 1 })).toBe(false); // crafting opens at Trúc Cơ
    expect(can({ realm: null })).toBe(false);
    expect(can({ have: 14 })).toBe(false);
    expect(can({ stones: 33 })).toBe(false);
    expect(can({}, far)).toBe(false);
    const { m } = model();
    m.applyState(state({ job: { recipeId: 2, done: 0, total: 1, remainingMs: 3000 } }));
    expect(m.recipes(near).some((r) => r.canStart)).toBe(false);
  });

  it('start sends one Start command, refuses a second while one is in flight, and times out a lost answer', () => {
    const { m, advance } = model();
    m.applyState(state());
    const sent: unknown[] = [];
    expect(m.start(2, 3, sendTo(sent))).toBe(true);
    expect(sent[0]).toEqual({ op: CraftOp.Start, requestId: REQ(1), recipeId: 2, count: 3 });
    expect(m.start(2, 3, sendTo(sent))).toBe(false);
    m.applyResult(result({ requestId: REQ(1) }));
    expect(m.toast()?.text).toContain('Bắt đầu luyện');
    advance(10);
    expect(m.start(2, 99, sendTo(sent))).toBe(true);
    expect((sent[1] as { count: number }).count).toBe(ALCHEMY.QUEUE_MAX); // clamped to the queue length
    const lost = model();
    lost.m.applyState(state());
    expect(lost.m.start(2, 1, sendTo([]))).toBe(true);
    lost.advance(5001);
    expect(lost.m.start(2, 1, sendTo([]))).toBe(true);
  });

  it('start returns false (and keeps no pending command) when the socket is closed', () => {
    const { m } = model();
    m.applyState(state());
    expect(m.start(2, 1, sendTo([], false))).toBe(false);
    expect(m.start(2, 1, sendTo([]))).toBe(true);
  });

  it('cancel only exists while a job runs', () => {
    const { m } = model();
    const sent: unknown[] = [];
    m.applyState(state());
    expect(m.cancel(sendTo(sent))).toBe(false);
    m.applyState(state({ job: { recipeId: 2, done: 1, total: 3, remainingMs: 2000 } }));
    expect(m.cancel(sendTo(sent))).toBe(true);
    expect(sent[0]).toMatchObject({ op: CraftOp.Cancel, recipeId: 0, count: 0 });
  });

  it('counts the running job down locally between server updates', () => {
    const { m, advance } = model();
    m.applyState(state({ job: { recipeId: 2, done: 1, total: 3, remainingMs: 4000 } }));
    expect(m.job()).toMatchObject({ name: 'Trúc Cơ Đan', done: 1, total: 3, remainingMs: 4000 });
    advance(1500);
    expect(m.job()!.remainingMs).toBe(2500);
    advance(9000);
    expect(m.job()!.remainingMs).toBe(0);
  });

  it('turns every outcome into a Vietnamese line; refusals use the reason text', () => {
    const { m } = model();
    m.applyResult(result({ outcome: CraftOutcome.Success, index: 0, quality: 3 }));
    expect(m.toast()).toMatchObject({ tone: 'good', text: 'Luyện Trúc Cơ Đan thành công: phẩm Tím.' });
    m.applyResult(result({ outcome: CraftOutcome.Failed, index: 1, lost: 9 }));
    expect(m.toast()).toMatchObject({ tone: 'bad', text: 'Luyện Trúc Cơ Đan thất bại: mất 9 nguyên liệu.' });
    m.applyResult(result({ outcome: CraftOutcome.Rejected, reason: CraftReason.TooFar }));
    expect(m.toast()?.text).toBe(CRAFT_REASON_TEXT[CraftReason.TooFar]);
    m.applyResult(result({ outcome: CraftOutcome.Cancelled, reason: CraftReason.Moved }));
    expect(m.toast()?.text).toContain('không mất gì');
    for (const r of Object.values(CraftReason).filter((x): x is number => typeof x === 'number'))
      expect(CRAFT_REASON_TEXT[r], `reason ${r}`).toBeDefined();
  });

  it('toasts expire', () => {
    const { m, advance } = model();
    m.applyResult(result({ outcome: CraftOutcome.Success, quality: 0 }));
    expect(m.toast()).not.toBeNull();
    advance(5000);
    expect(m.toast()).toBeNull();
  });
});
